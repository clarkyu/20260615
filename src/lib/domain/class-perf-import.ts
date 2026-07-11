// 雨课堂导入编排(domain):解析产物 × 班级花名册 → 匹配/修正/合并 → 预览或落库。
// 无 auth/i18n/Next;警示沿用 parser 的「key:载荷」约定(聚合级,不含学生个体信息),
// 个体级信息(修正/合并/未匹配名单)走结构化列表,只在老师预览页展示。
// 权重固定为「追溯宽松」预设(规则晚于行为公布的学期,考勤主导)——后续如需可调另开配置口。
//
// 匹配口径(clark 2026-07-10 定):**以系统名单为准,优先按姓名匹配**——雨课堂里学号/姓名是
// 学生自己填的,常见不规范(内部号、全角、空格、间隔号变体);系统花名册来自学校点名册,权威。
// 1) 双侧规范化(去空白/全角转半角/间隔号统一);2) 姓名唯一命中 → 归入(学号顺带修正);
//    同名多人 → 用学号消歧,消不了列未匹配(绝不在同名学生间猜);无名中 → 学号精确兜底;
// 3) 同一系统学生名下的多行雨课堂数据**合并**(到课 OR、条数 SUM、答题 OR——与 parser
//    同学号合并同语义);4) 落库行一律写系统学号/姓名(修正),原始身份存 summaryJson.sources 备审。
import type { PrismaClient } from '@prisma/client'
import * as classPerfRepo from '@/lib/repo/class-perf'
import type { RainSession, RainStudent, RainStudentDetail } from '@/lib/rain-classroom'
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

// ── 规范化(修正不规范/不标准资料的比较基准) ─────────────────────────────────────

// 全角字母数字 → 半角。
const fullToHalf = (s: string) => s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))

// 空白 + 零宽字符(U+200B/200C/200D/FEFF)——雨课堂自填资料里常见的隐形脏字符。
const INVISIBLE = /[\s\u3000\u200b\u200c\u200d\ufeff]+/g

// 姓名规范化:去所有空白/零宽,间隔号变体(·・•.)统一为「·」,全角转半角,
// 拉丁字母小写——只作比较键,展示与落库仍用系统原文。
export function normName(s: string | null | undefined): string {
  if (!s) return ''
  return fullToHalf(String(s)).replace(INVISIBLE, '').replace(/[·・•.]+/g, '·').toLowerCase()
}

// 学号规范化:去空白/零宽、全角转半角。不去前导零(学号是标识符不是数)。
export function normNo(s: string | null | undefined): string {
  if (!s) return ''
  return fullToHalf(String(s)).replace(INVISIBLE, '')
}

// ── 匹配结果 ────────────────────────────────────────────────────────────────────

export interface MatchedStudent {
  userId: number
  studentNo: string // 系统学号(以系统名单为准)
  name: string // 系统姓名
  via: 'name' | 'name+no' | 'no'
  sources: { studentNo: string; name: string }[] // 雨课堂原始身份(≥1;>1 即发生合并)
  detail: RainStudentDetail[] // 合并后的逐节信号
  summaryAttended: number
  summaryDanmaku: number
  summaryPosts: number
}

export interface ImportMatch {
  matched: MatchedStudent[]
  unmatched: { studentNo: string; name: string }[] // 文件有、无法安全归入:不建账号,行仍入库备查
  missingFromFile: { studentNo: string; name: string }[] // 花名册有、文件无:导入后课堂列=无数据
  corrections: { fromNo: string; fromName: string; toNo: string; toName: string; via: MatchedStudent['via'] }[]
  merges: { studentNo: string; name: string; rows: number }[] // 同一学生多行雨课堂数据被合并
  duplicateCount: number // parser 同学号合并数(原义保留)
  warnings: string[] // 聚合级:rain.warnDupName:N / rain.warnNoConflict:N
}

const ZERO: RainStudentDetail = { attended: false, danmaku: 0, posts: 0, answered: false }

// 逐节合并(与 parser 同学号合并同语义):到课 OR、条数 SUM、答题 OR。
export function mergeDetails(a: RainStudentDetail[], b: RainStudentDetail[]): RainStudentDetail[] {
  const n = Math.max(a.length, b.length)
  const out: RainStudentDetail[] = []
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? ZERO
    const y = b[i] ?? ZERO
    out.push({
      attended: x.attended || y.attended,
      danmaku: x.danmaku + y.danmaku,
      posts: x.posts + y.posts,
      answered: x.answered || y.answered,
    })
  }
  return out
}

// 姓名优先匹配 + 修正 + 合并(纯函数)。绝不在同名学生间猜:同名多人只能靠学号消歧,
// 消歧不了 → 未匹配(预览列出,老师人工处理)。
export function matchRoster(students: RainStudent[], roster: RosterEntry[]): ImportMatch {
  const byNo = new Map<string, RosterEntry>()
  const dupNos = new Set<string>()
  const byName = new Map<string, RosterEntry[]>()
  for (const r of roster) {
    const no = normNo(r.studentNo)
    if (!no) continue // 无学号的花名册行不参与匹配:落库以系统学号为主键身份,空学号无法安全落行
    if (byNo.has(no)) dupNos.add(no)
    else byNo.set(no, r)
    const nm = normName(r.name)
    if (nm) {
      const arr = byName.get(nm) ?? []
      arr.push(r)
      byName.set(nm, arr)
    }
  }
  // 花名册里规范化后撞号的学生(如内部空格/全角差异):学号通道整体作废——学号兜底
  // 命中歧义键就是在两个学生之间猜,与同名多人同罪,一律不猜(镜像 byName 的处理)。
  for (const d of dupNos) byNo.delete(d)

  const byTarget = new Map<number, MatchedStudent>()
  const unmatched: ImportMatch['unmatched'] = []
  const corrections: ImportMatch['corrections'] = []
  let duplicateCount = 0
  let dupNameCount = 0
  let dupNoCount = 0
  let noConflictCount = 0

  for (const s of students) {
    if (s.duplicated) duplicateCount++
    const nName = normName(s.name)
    const nNo = normNo(s.studentNo)
    const nameCands = nName ? (byName.get(nName) ?? []) : []
    const noHit = nNo ? byNo.get(nNo) : undefined

    let target: RosterEntry | undefined
    let via: MatchedStudent['via'] | undefined
    if (nameCands.length === 1) {
      target = nameCands[0]
      via = 'name'
      // 学号撞了系统里另一个学生:按姓名归入(clark 口径),但计入聚合警示供老师留意。
      if (noHit && noHit.id !== target.id) noConflictCount++
    } else if (nameCands.length > 1) {
      // 同名多人:学号必须唯一指向其中一人才归入;命中 0 个或多个都不猜。
      const disambiguated = nameCands.filter((c) => normNo(c.studentNo) === nNo)
      if (disambiguated.length === 1) {
        target = disambiguated[0]
        via = 'name+no'
      } else {
        dupNameCount++ // 同名多人且学号消歧不了:不猜
      }
    } else if (noHit) {
      target = noHit
      via = 'no'
    } else if (nNo && dupNos.has(nNo)) {
      dupNoCount++ // 学号命中的是歧义键(花名册撞号):不猜
    }

    if (!target || !via) {
      unmatched.push({ studentNo: s.studentNo, name: s.name })
      continue
    }

    const sysNo = target.studentNo?.trim() ?? ''
    const sysName = target.name?.trim() ?? ''
    if (s.studentNo !== sysNo || s.name.trim() !== sysName) {
      corrections.push({ fromNo: s.studentNo, fromName: s.name, toNo: sysNo, toName: sysName, via })
    }

    const prev = byTarget.get(target.id)
    if (prev) {
      prev.sources.push({ studentNo: s.studentNo, name: s.name })
      prev.detail = mergeDetails(prev.detail, s.detail)
      prev.summaryAttended += s.summaryAttended
      prev.summaryDanmaku += s.summaryDanmaku
      prev.summaryPosts += s.summaryPosts
      // 后并入的行若匹配方式更「硬」(name+no),提级展示;分数只看 detail,不受影响。
      if (via === 'name+no') prev.via = via
    } else {
      byTarget.set(target.id, {
        userId: target.id,
        studentNo: sysNo,
        name: sysName,
        via,
        sources: [{ studentNo: s.studentNo, name: s.name }],
        detail: s.detail.map((d) => ({ ...d })),
        summaryAttended: s.summaryAttended,
        summaryDanmaku: s.summaryDanmaku,
        summaryPosts: s.summaryPosts,
      })
    }
  }

  // 落库防撞终检:两个不同系统学生 trim 后同号(遗留脏数据)都被匹配时,
  // (importId, studentNo) 唯一键必炸——按 userId 序保第一个,其余整体退回未匹配。
  const all = [...byTarget.values()].sort((a, b) => a.userId - b.userId)
  const seenSysNo = new Set<string>()
  const matched: MatchedStudent[] = []
  const evicted = new Set<string>()
  for (const m of all) {
    if (seenSysNo.has(m.studentNo)) {
      unmatched.push(...m.sources)
      for (const src of m.sources) evicted.add(`${src.studentNo} ${src.name}`)
      dupNoCount++
      continue
    }
    seenSysNo.add(m.studentNo)
    matched.push(m)
  }
  matched.sort((a, b) => a.studentNo.localeCompare(b.studentNo))
  // 被退回未匹配的行,不该再出现在「已修正」名单里(名单必须与实际落库一致)。
  const finalCorrections = corrections.filter((c) => !evicted.has(`${c.fromNo} ${c.fromName}`))
  const merges = matched
    .filter((m) => m.sources.length > 1)
    .map((m) => ({ studentNo: m.studentNo, name: m.name, rows: m.sources.length }))
  const claimed = new Set(matched.map((m) => m.userId))
  const missingFromFile = roster
    .filter((r) => r.studentNo?.trim() && !claimed.has(r.id))
    .map((r) => ({ studentNo: r.studentNo!.trim(), name: r.name ?? '' }))

  const warnings: string[] = []
  if (dupNameCount > 0) warnings.push(`rain.warnDupName:${dupNameCount}`)
  if (dupNoCount > 0) warnings.push(`rain.warnDupNo:${dupNoCount}`)
  if (noConflictCount > 0) warnings.push(`rain.warnNoConflict:${noConflictCount}`)

  return { matched, unmatched, missingFromFile, corrections: finalCorrections, merges, duplicateCount, warnings }
}

export interface ImportPreview {
  fileName: string
  sessions: RainSession[]
  countedSessions: number
  declaredSessions: number | null
  rowCount: number
  matchedCount: number // 匹配到的系统学生数(合并后)
  duplicateCount: number
  unmatched: { studentNo: string; name: string }[]
  missingFromFile: { studentNo: string; name: string }[]
  corrections: ImportMatch['corrections'] // 学号/姓名被修正为系统资料的行
  merges: ImportMatch['merges'] // 同一学生多行合并
  warnings: string[]
  scoreMean: number | null // 匹配学生按宽松权重的预估均分(round1)
  floored: { studentNo: string; name: string }[] // 被保底救起名单(公平护栏,老师知情)
}

// 预览摘要(纯函数):确认导入前老师必须过目的全部对账信息——匹配/缺席两向名单、
// 修正与合并明细、节次口径、解析警示、预估分布(均分 + 保底名单)。
export function buildImportPreview(fileName: string, parsed: RainParsedOk, roster: RosterEntry[]): ImportPreview {
  const m = matchRoster(parsed.students, roster)
  const floored: ImportPreview['floored'] = []
  const scores: number[] = []
  for (const s of m.matched) {
    // 合并后的 detail 计分:同一学生两行数据先并再算,不会低估
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
    matchedCount: m.matched.length,
    duplicateCount: m.duplicateCount,
    unmatched: m.unmatched,
    missingFromFile: m.missingFromFile,
    corrections: m.corrections,
    merges: m.merges,
    warnings: [...parsed.warnings, ...m.warnings],
    scoreMean,
    floored,
  }
}

// 每生一行的落库载荷:**匹配行写系统学号/姓名**(以系统名单为准,即「修正」落地),
// 原始身份存 summaryJson.sources 备审;未匹配行原样入库(userId null,只备查不进成绩)。
// detailJson 存合并后的逐节原始信号(评分读时由公式 B 现算,权重可换不用重导)。
export function buildStudentRows(importId: number, m: ImportMatch): classPerfRepo.NewClassPerfStudent[] {
  const matchedRows = m.matched.map((s) => ({
    importId,
    studentNo: s.studentNo,
    userId: s.userId,
    name: s.name || null,
    summaryJson: JSON.stringify({
      attended: s.summaryAttended,
      danmaku: s.summaryDanmaku,
      posts: s.summaryPosts,
      via: s.via,
      merged: s.sources.length > 1,
      sources: s.sources,
    }),
    detailJson: JSON.stringify(s.detail),
  }))
  return matchedRows
}

// 未匹配行单独装配(原样身份,备查):与匹配行分开,避免系统学号与雨课堂学号撞
// @@unique(importId, studentNo)——若原始学号恰与某系统学号相同且都入库,create 会撞唯一键,
// 这里给未匹配行加「!」前缀隔离(展示层只在老师端备查,不参与任何匹配/成绩)。
export function buildUnmatchedRows(
  importId: number,
  students: RainStudent[],
  m: ImportMatch,
): classPerfRepo.NewClassPerfStudent[] {
  const unmatchedKeys = new Set(m.unmatched.map((u) => `${u.studentNo}\u0000${u.name}`))
  const matchedNos = new Set(m.matched.map((x) => x.studentNo))
  return students
    .filter((s) => unmatchedKeys.has(`${s.studentNo}\u0000${s.name}`))
    .map((s) => ({
      importId,
      studentNo: matchedNos.has(s.studentNo) ? `!${s.studentNo}` : s.studentNo,
      userId: null,
      name: s.name || null,
      summaryJson: JSON.stringify({
        attended: s.summaryAttended,
        danmaku: s.summaryDanmaku,
        posts: s.summaryPosts,
        duplicated: s.duplicated,
        unmatched: true,
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
    matchedCount: m.matched.length,
    unmatchedCount: m.unmatched.length,
    duplicateCount: m.duplicateCount,
    importedById,
  })
  try {
    await classPerfRepo.createStudents(prisma, [...buildStudentRows(imp.id, m), ...buildUnmatchedRows(imp.id, parsed.students, m)])
  } catch (e) {
    await classPerfRepo.deleteImportById(prisma, imp.id, offeringId).catch(() => {})
    throw e
  }
  return { importId: imp.id, rowCount: parsed.students.length, matchedCount: m.matched.length, unmatchedCount: m.unmatched.length }
}
