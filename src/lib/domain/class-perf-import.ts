// 雨课堂导入编排(domain):解析产物 × 班级花名册 → 学号匹配/对账摘要 → 预览或落库。
// 无 auth/i18n/Next;警示沿用 parser 的「key:载荷」约定,由页面翻译展示。
// 权重固定为「追溯宽松」预设(规则晚于行为公布的学期,考勤主导)——后续如需可调另开配置口。
import type { PrismaClient } from '@prisma/client'
import * as classPerfRepo from '@/lib/repo/class-perf'
import type { RainSession, RainStudent } from '@/lib/rain-classroom'
import { computeClassPerfScore, CLASSPERF_LENIENT_WEIGHTS } from './class-perf'

export interface RosterEntry {
  id: number
  studentNo: string | null
  name: string | null
}

// parseRainClassroom 的 ok 分支(结构复述,避免联合类型在层间来回收窄)。
export interface RainParsedOk {
  sessions: RainSession[]
  students: RainStudent[]
  declaredSessions: number | null
  warnings: string[]
}

export interface ImportMatch {
  userIdByNo: Map<string, number>
  matchedCount: number
  unmatched: { studentNo: string; name: string }[] // 文件有、花名册无:不建账号,行仍入库备查
  missingFromFile: { studentNo: string; name: string }[] // 花名册有、文件无:导入后课堂列=无数据
  duplicateCount: number
}

// 学号精确匹配(parser 已 trim/合并重复学号)。不做模糊匹配——错配比不配对 minors 危害更大,
// 未匹配的走预览人工核对。
export function matchRoster(students: RainStudent[], roster: RosterEntry[]): ImportMatch {
  const byNo = new Map<string, number>()
  for (const r of roster) {
    const no = r.studentNo?.trim()
    if (no) byNo.set(no, r.id)
  }
  const userIdByNo = new Map<string, number>()
  const unmatched: ImportMatch['unmatched'] = []
  const fileNos = new Set<string>()
  let duplicateCount = 0
  for (const s of students) {
    fileNos.add(s.studentNo)
    if (s.duplicated) duplicateCount++
    const uid = byNo.get(s.studentNo)
    if (uid != null) userIdByNo.set(s.studentNo, uid)
    else unmatched.push({ studentNo: s.studentNo, name: s.name })
  }
  const missingFromFile = roster
    .filter((r) => r.studentNo?.trim() && !fileNos.has(r.studentNo.trim()))
    .map((r) => ({ studentNo: r.studentNo!.trim(), name: r.name ?? '' }))
  return { userIdByNo, matchedCount: userIdByNo.size, unmatched, missingFromFile, duplicateCount }
}

export interface ImportPreview {
  fileName: string
  sessions: RainSession[]
  countedSessions: number
  declaredSessions: number | null
  rowCount: number
  matchedCount: number
  duplicateCount: number
  unmatched: { studentNo: string; name: string }[]
  missingFromFile: { studentNo: string; name: string }[]
  warnings: string[]
  scoreMean: number | null // 匹配学生按宽松权重的预估均分(round1)
  floored: { studentNo: string; name: string }[] // 被保底救起名单(公平护栏,老师知情)
}

// 预览摘要(纯函数):确认导入前老师必须过目的全部对账信息——匹配/缺席两向名单、
// 节次口径、解析警示、预估分布(均分 + 保底名单)。
export function buildImportPreview(fileName: string, parsed: RainParsedOk, roster: RosterEntry[]): ImportPreview {
  const m = matchRoster(parsed.students, roster)
  const floored: ImportPreview['floored'] = []
  const scores: number[] = []
  for (const s of parsed.students) {
    if (!m.userIdByNo.has(s.studentNo)) continue // 未匹配不进成绩,也不进预估
    const r = computeClassPerfScore(s.detail, parsed.sessions, CLASSPERF_LENIENT_WEIGHTS)
    if (r.score != null) scores.push(r.score)
    if (r.floored) floored.push({ studentNo: s.studentNo, name: s.name })
  }
  const scoreMean = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null
  return {
    fileName,
    sessions: parsed.sessions,
    countedSessions: parsed.sessions.filter((s) => s.counted).length,
    declaredSessions: parsed.declaredSessions,
    rowCount: parsed.students.length,
    matchedCount: m.matchedCount,
    duplicateCount: m.duplicateCount,
    unmatched: m.unmatched,
    missingFromFile: m.missingFromFile,
    warnings: parsed.warnings,
    scoreMean,
    floored,
  }
}

// 每生一行的落库载荷:summaryJson 存汇总列快照(权威口径,供日后对账),detailJson 存
// 逐节原始信号(评分读时由公式 B 现算,权重可换不用重导)。
export function buildStudentRows(
  importId: number,
  students: RainStudent[],
  userIdByNo: Map<string, number>,
): classPerfRepo.NewClassPerfStudent[] {
  return students.map((s) => ({
    importId,
    studentNo: s.studentNo,
    userId: userIdByNo.get(s.studentNo) ?? null,
    name: s.name || null,
    summaryJson: JSON.stringify({
      attended: s.summaryAttended,
      danmaku: s.summaryDanmaku,
      posts: s.summaryPosts,
      duplicated: s.duplicated,
    }),
    detailJson: JSON.stringify(s.detail),
  }))
}

// 落库:台账行 + 分批学生行。每次导入是新版本(不覆盖旧导入),总评默认用最新、
// 配置可钉住某一版。D1 无交互事务:分批写中途失败 → 删台账行级联清理,不留半截版本。
export async function commitImport(
  prisma: PrismaClient,
  offeringId: number,
  fileName: string,
  parsed: RainParsedOk,
  roster: RosterEntry[],
  importedById: number,
): Promise<{ importId: number; rowCount: number; matchedCount: number; unmatchedCount: number }> {
  const m = matchRoster(parsed.students, roster)
  const imp = await classPerfRepo.createImport(prisma, {
    offeringId,
    fileName: fileName.slice(0, 200),
    sessionsJson: JSON.stringify(parsed.sessions),
    weightsJson: JSON.stringify(CLASSPERF_LENIENT_WEIGHTS),
    rowCount: parsed.students.length,
    matchedCount: m.matchedCount,
    unmatchedCount: m.unmatched.length,
    duplicateCount: m.duplicateCount,
    importedById,
  })
  try {
    await classPerfRepo.createStudents(prisma, buildStudentRows(imp.id, parsed.students, m.userIdByNo))
  } catch (e) {
    await classPerfRepo.deleteImportById(prisma, imp.id, offeringId).catch(() => {})
    throw e
  }
  return { importId: imp.id, rowCount: parsed.students.length, matchedCount: m.matchedCount, unmatchedCount: m.unmatched.length }
}
