// 雨课堂原始数据透出(domain):老师看全班逐生逐节信号矩阵,学生看本人逐节记录。
// 展示与评分同一数据版本(配置钉住的导入优先、否则最新)、同一公式(class-perf 公式 B),
// 保证「看到的原始数据」与「算出的课堂分」可相互印证(minors 申诉安全)。
import type { PrismaClient, Role } from '@prisma/client'
import * as classPerfRepo from '@/lib/repo/class-perf'
import * as reviewRepo from '@/lib/repo/review'
import type { RainSession, RainStudentDetail } from '@/lib/rain-classroom'
import { computeClassPerfScore, CLASSPERF_DEFAULT_WEIGHTS, type ClassPerfWeights } from './class-perf'

interface Actor {
  schoolId: number | null | undefined
  userId: number
  role: Role
}

export interface RainStudentRow {
  studentNo: string
  name: string | null
  matched: boolean // 花名册里有账号(userId 非空);未匹配行只在老师端展示备查
  attended: number // 到课节数(只数计次节,与评分分母同口径)
  countedSessions: number
  danmaku: number // 计次节内条数合计(仅展示;评分是二值参与)
  posts: number
  answeredSessions: number // 答过≥1题的节数
  questionSessions: number // 有题的计次节数
  score: number | null
  floored: boolean
  detail: RainStudentDetail[] // 与 sessions 按下标对齐(含不计次节)
}

// 从配置 JSON 读钉住的导入 id(损坏/缺失回 null → 用最新)。与 review-load 同口径。
export function pinnedImportId(configJson: string | null | undefined): number | null {
  if (!configJson) return null
  try {
    const c = JSON.parse(configJson) as { categories?: { classroom?: { classPerfImportId?: unknown } } }
    const id = c?.categories?.classroom?.classPerfImportId
    return typeof id === 'number' && Number.isInteger(id) ? id : null
  } catch {
    return null
  }
}

export function parseWeights(json: string | null | undefined): ClassPerfWeights {
  try {
    return { ...CLASSPERF_DEFAULT_WEIGHTS, ...(JSON.parse(json ?? '') as Partial<ClassPerfWeights>) }
  } catch {
    return { ...CLASSPERF_DEFAULT_WEIGHTS }
  }
}

const ZERO: RainStudentDetail = { attended: false, danmaku: 0, posts: 0, answered: false }

// 逐生汇总行(纯函数):totals 只数计次节,与公式 B 分母同口径。
export function buildStudentRow(
  studentNo: string,
  name: string | null,
  matched: boolean,
  detail: RainStudentDetail[],
  sessions: RainSession[],
  weights: ClassPerfWeights,
): RainStudentRow {
  const r = computeClassPerfScore(detail, sessions, weights)
  let attended = 0
  let counted = 0
  let danmaku = 0
  let posts = 0
  let answered = 0
  let questions = 0
  sessions.forEach((s, i) => {
    if (!s.counted) return
    counted++
    const d = detail[i] ?? ZERO
    if (d.attended) attended++
    danmaku += d.danmaku
    posts += d.posts
    if (s.questions > 0) {
      questions++
      if (d.answered) answered++
    }
  })
  return {
    studentNo,
    name,
    matched,
    attended,
    countedSessions: counted,
    danmaku,
    posts,
    answeredSessions: answered,
    questionSessions: questions,
    score: r.score,
    floored: r.floored,
    detail,
  }
}

export interface RainClassView {
  importId: number
  fileName: string
  createdAt: Date
  sessions: RainSession[]
  weights: ClassPerfWeights
  students: RainStudentRow[]
}

// 老师端:全班视图。数据版本 = 配置钉住的导入 ?? 最新导入(与工作台课堂列同一解析)。
export async function loadClassRainView(prisma: PrismaClient, offeringId: number, actor: Actor): Promise<RainClassView | null> {
  const { schoolId, userId, role } = actor
  const [cfg, latest] = await Promise.all([
    reviewRepo.getConfig(prisma, offeringId, schoolId, userId, role),
    classPerfRepo.latestImport(prisma, offeringId, schoolId, userId, role),
  ])
  const pin = pinnedImportId(cfg?.configJson)
  const imp =
    pin != null && pin !== latest?.id
      ? (await classPerfRepo.importById(prisma, pin, offeringId, schoolId, userId, role)) ?? latest
      : latest
  if (!imp) return null
  let sessions: RainSession[]
  try {
    sessions = JSON.parse(imp.sessionsJson) as RainSession[]
  } catch {
    return null // 台账行损坏:按未导入展示,不掀翻页面
  }
  const weights = parseWeights(imp.weightsJson)
  const rows = await classPerfRepo.listImportStudents(prisma, imp.id, schoolId, userId, role)
  const students = rows.map((r) => {
    let detail: RainStudentDetail[]
    try {
      detail = JSON.parse(r.detailJson) as RainStudentDetail[]
    } catch {
      detail = []
    }
    return buildStudentRow(r.studentNo, r.name, r.userId != null, detail, sessions, weights)
  })
  return { importId: imp.id, fileName: imp.fileName, createdAt: imp.createdAt, sessions, weights, students }
}

export interface StudentRainView {
  offering: { id: number; year: string; semester: string; course: string; klass: string }
  createdAt: Date
  sessions: RainSession[]
  row: RainStudentRow
}

type UserRainRow = Awaited<ReturnType<typeof classPerfRepo.listRainRowsForUser>>[number]

// 每 offering 择版(纯函数):配置钉住的导入优先,否则最新一次——与老师端/评分同一口径。
export function pickRowPerOffering(rows: UserRainRow[], pinByOffering: Map<number, number | null>): UserRainRow[] {
  const byOffering = new Map<number, UserRainRow>()
  for (const r of rows) {
    const off = r.import.offeringId
    const pin = pinByOffering.get(off) ?? null
    const cur = byOffering.get(off)
    if (pin != null) {
      if (r.import.id === pin) byOffering.set(off, r)
      else if (!cur || (cur.import.id !== pin && r.import.id > cur.import.id)) byOffering.set(off, r)
    } else if (!cur || r.import.id > cur.import.id) {
      byOffering.set(off, r)
    }
  }
  return [...byOffering.values()]
}

// 学生端:本人各课头的原始记录(只回本人行,repo 层已按 userId 过滤)。
export async function loadStudentRainViews(prisma: PrismaClient, userId: number): Promise<StudentRainView[]> {
  const [rows, cfgs] = await Promise.all([
    classPerfRepo.listRainRowsForUser(prisma, userId),
    reviewRepo.listConfigsForStudent(prisma, userId),
  ])
  if (rows.length === 0) return []
  const pins = new Map(cfgs.map((c) => [c.offeringId, pinnedImportId(c.configJson)]))
  return pickRowPerOffering(rows, pins)
    .map((r) => {
      let sessions: RainSession[]
      let detail: RainStudentDetail[]
      try {
        sessions = JSON.parse(r.import.sessionsJson) as RainSession[]
        detail = JSON.parse(r.detailJson) as RainStudentDetail[]
      } catch {
        return null
      }
      const weights = parseWeights(r.import.weightsJson)
      return {
        offering: {
          id: r.import.offering.id,
          year: r.import.offering.year,
          semester: r.import.offering.semester,
          course: r.import.offering.course.name,
          klass: r.import.offering.class.name,
        },
        createdAt: r.import.createdAt,
        sessions,
        row: buildStudentRow(r.studentNo, r.name, true, detail, sessions, weights),
      }
    })
    .filter((x): x is StudentRainView => x != null)
    .sort((a, b) => b.offering.id - a.offering.id)
}
