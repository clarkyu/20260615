// 学期总评工作台装配:把三条既有分数流(课堂表现/训练/期末)读出来喂给 review.ts 纯函数。
// 依赖只向下(repo/analytics/class-perf),无 auth/i18n/Next;页面与后续发布/学生页共用,
// 保证「学生所见=老师所见=快照所得」同一装配口径。
import type { PrismaClient, Role } from '@prisma/client'
import * as submissionRepo from '@/lib/repo/submissions'
import * as userRepo from '@/lib/repo/users'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as reviewRepo from '@/lib/repo/review'
import * as classPerfRepo from '@/lib/repo/class-perf'
import { latestPhaseSubmissions, collapsePhases } from '@/lib/domain/analytics'
import { computeClassPerfScore, CLASSPERF_DEFAULT_WEIGHTS, type ClassPerfWeights } from '@/lib/domain/class-perf'
import type { RainSession, RainStudentDetail } from '@/lib/rain-classroom'
import {
  defaultReviewConfig,
  validateReviewConfig,
  type OverrideInput,
  type ReviewCategoryKey,
  type ReviewConfig,
  type StudentCategoryInputs,
} from './review'

export interface WorkbenchStudent {
  id: number
  no: string | null
  name: string | null
  inputs: StudentCategoryInputs
  overrides: OverrideInput[]
}

export interface WorkbenchData {
  config: ReviewConfig
  configVersion: number // 乐观锁:保存时回传
  students: WorkbenchStudent[]
  assignments: { id: number; title: string }[] // 训练/期末子项标题(工作台展示用)
  classPerf: { importId: number; fileName: string; createdAt: Date; sessions: number } | null
}

interface Actor {
  schoolId: number | null | undefined
  userId: number
  role: Role
}

// configJson 安全解析:损坏/旧版一律回退默认(草稿态,无数据风险;发布前有校验兜底)。
export function parseReviewConfig(json: string | null | undefined, fallback: ReviewConfig): ReviewConfig {
  if (!json) return fallback
  try {
    const parsed = JSON.parse(json) as ReviewConfig
    if (parsed?.v !== 1 || validateReviewConfig(parsed) !== null) return fallback
    return parsed
  } catch {
    return fallback
  }
}

export async function loadReviewWorkbench(
  prisma: PrismaClient,
  offering: { id: number; classId: number },
  actor: Actor,
): Promise<WorkbenchData> {
  const { schoolId, userId, role } = actor
  const [allAssignments, cfgRow, latestImp, roster, overrideRows, rows] = await Promise.all([
    assignmentRepo.listForOfferingBrief(prisma, offering.id),
    reviewRepo.getConfig(prisma, offering.id, schoolId, userId, role),
    classPerfRepo.latestImport(prisma, offering.id, schoolId, userId, role),
    userRepo.listClassRoster(prisma, schoolId, offering.classId),
    reviewRepo.listOverrides(prisma, offering.id, schoolId, userId, role),
    submissionRepo.listForOfferingGradebook(prisma, offering.id, schoolId, userId, role),
  ])

  const fallback = defaultReviewConfig(allAssignments, latestImp?.id ?? null)
  const config = parseReviewConfig(cfgRow?.configJson, fallback)

  // 课堂表现分:配置钉住的导入优先,未钉/失效回落最新;逐生由公式B现算。
  const pinnedId = config.categories.classroom.classPerfImportId
  const imp =
    pinnedId != null && pinnedId !== latestImp?.id
      ? (await classPerfRepo.importById(prisma, pinnedId, offering.id, schoolId, userId, role)) ?? latestImp
      : latestImp
  const classroomByUser = new Map<number, number | null>()
  let sessionsCount = 0
  if (imp) {
    try {
      const sessions = JSON.parse(imp.sessionsJson) as RainSession[]
      const weights = { ...CLASSPERF_DEFAULT_WEIGHTS, ...(JSON.parse(imp.weightsJson) as Partial<ClassPerfWeights>) }
      sessionsCount = sessions.filter((s) => s.counted).length
      const perfRows = await classPerfRepo.listImportStudents(prisma, imp.id, schoolId, userId, role)
      for (const r of perfRows) {
        if (r.userId == null) continue
        const detail = JSON.parse(r.detailJson) as RainStudentDetail[]
        classroomByUser.set(r.userId, computeClassPerfScore(detail, sessions, weights).score)
      }
    } catch {
      // 导入行损坏:课堂列按无数据处理(工作台会显示未导入提示),不掀翻整页。
    }
  }

  // 训练/期末:既有口径合成 per (student, assignment) 分;status=DRAFT(未交)视为 null。
  const collapsed = collapsePhases(latestPhaseSubmissions(rows))
  const byStudentAssignment = new Map<string, number | null>()
  for (const c of collapsed) {
    byStudentAssignment.set(`${c.studentId}:${c.assignmentId}`, c.status === 'DRAFT' ? null : c.finalScore)
  }
  const score = (studentId: number, assignmentId: number) => byStudentAssignment.get(`${studentId}:${assignmentId}`) ?? null

  const trainingIds = config.categories.training.assignmentIds
  const finalIds = config.categories.final.assignmentIds
  const overridesByStudent = new Map<number, OverrideInput[]>()
  for (const o of overrideRows) {
    const arr = overridesByStudent.get(o.studentId) ?? []
    arr.push({ categoryKey: o.categoryKey as ReviewCategoryKey, score: o.score, state: o.state as 'OVERRIDE' | 'EXEMPT' })
    overridesByStudent.set(o.studentId, arr)
  }

  const students: WorkbenchStudent[] = roster.map((s) => ({
    id: s.id,
    no: s.studentNo,
    name: s.name,
    inputs: {
      classroom: classroomByUser.get(s.id) ?? null,
      trainingParts: trainingIds.map((aid) => score(s.id, aid)),
      // 期末单作业(多份时取第一份;配置层保证正常只有一份)。
      final: finalIds.length > 0 ? score(s.id, finalIds[0]) : null,
    },
    overrides: overridesByStudent.get(s.id) ?? [],
  }))

  const titled = new Map(allAssignments.map((a) => [a.id, a.title]))
  return {
    config,
    configVersion: cfgRow?.version ?? 0,
    students,
    assignments: [...trainingIds, ...finalIds].map((id) => ({ id, title: titled.get(id) ?? `#${id}` })),
    classPerf: imp ? { importId: imp.id, fileName: imp.fileName, createdAt: imp.createdAt, sessions: sessionsCount } : null,
  }
}
