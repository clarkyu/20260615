import type { PrismaClient, Role } from '@prisma/client'
import * as assignments from '@/lib/repo/assignments'
import * as submissions from '@/lib/repo/submissions'
import { cancelPendingForSubmissions } from './jobs'
import { normalizeAnswer } from '@/lib/fill-blank'
import { parseChoices } from '@/lib/choices'

// 环节统一为单选投票(一次性维护工具 + 常驻的人工归票):
// 同一批次作业的同序环节,一部分班是「单选投票」、一部分班误配成「默写文本」。学生两种
// 作答存的是同一个字段(recitedText:投票存选项原文、默写存打的字),投票计票就是拿
// recitedText 与选项文本做精确匹配——所以把默写环节改型为投票、并把「归一化后与某选项
// 等价」的作答规范化为选项原文,已有提交零删除、语义无损。对不上的原文原样保留,
// 由老师在评分页人工比对归票(assignPollVote)。

export interface UnmatchedAnswer {
  submissionId: number
  studentNo: string
  studentName: string
  text: string
}

export interface UnifyTargetReport {
  className: string
  assignmentId: number
  phaseId: number
  total: number // 每人只算最新一次(与投票计票、「未归票作答」列表同口径)
  alreadyCanonical: number // 原文已与某选项逐字相同(计票本就命中),无需改写
  autoMatched: number // 归一化后等价 → 改写为选项规范原文(apply 时执行)
  unmatched: UnmatchedAnswer[] // 对不上任何选项 → 原样保留,人工归票
  blank: number // 空白作答(trim 后为空):评分页工作台不显示、无从归票——单列,不算「待人工」(复查 R15)
  // 作答明细对比(按原文聚合、按人数降序):老师执行前就能看到学生写了什么、各归到哪。
  answers: { text: string; count: number; matchedOption: string | null }[]
  pendingReview: number // needsReview 待清(apply 时全环节清 0,含历史 attempt)
  scored: number // 已有分数的提交数(含历史 attempt)——按约定应为 0,>0 时拒绝 apply
}

export type UnifyReport =
  | {
      ok: true
      applied: boolean
      options: string[]
      templateClasses: string[]
      skipped: { className: string; reason: string }[]
      targets: UnifyTargetReport[]
    }
  | { ok: false; error: string }

// 一个候选目标环节的最小结构(平台级与 staff-scoped 两条读路径共用)。
interface TargetPhaseRow {
  id: number
  requireText: boolean
  requireChoice: boolean
  requireFreeText: boolean
  requireHandwriting: boolean
  fillBlank: boolean
  requireAudio: boolean
  requireVideo: boolean
  assignment: { id: number; offering: { class: { name: string } } }
  submissions: { id: number; studentId: number; attempt: number; recitedText: string | null; needsReview: boolean; finalScore: number | null; student: { name: string | null; studentNo: string | null } | null }[]
}

// 只有「纯默写文本」环节才是统一目标:任何附加提交类型(手写照片/自由文本/音视频/填空)
// 都排除——convertPhaseToPoll 不清这些旗标,混合环节改型会得到 itemType 与
// phaseItemType() 推导矛盾的杂交型,学生重投还会被迫补传手写照(复查 R4)。
// 此谓词是唯一事实来源:维护端点与老师自助两条路径共用,勿再各写一份。
const isTextTargetPhase = (p: TargetPhaseRow) =>
  p.requireText &&
  !p.requireChoice &&
  !p.requireFreeText &&
  !p.requireHandwriting &&
  !p.fillBlank &&
  !p.requireAudio &&
  !p.requireVideo

// 目标环节的转换计划:逐份提交分为 逐字命中 / 归一化等价(改写为规范原文)/ 对不上(保留)。
// 匹配与计数只看**每个学生的最新一次提交**——投票计票和「未归票作答」列表都是这个口径,
// 否则重交过的学生被重复计数,报告份数会大于班级人数。分数与待清复核仍统计全部行
// (老 attempt 的分数同样违反「无评分」前提;needsReview 清理也是全环节的)。
function buildPlan(p: TargetPhaseRow, byNorm: Map<string, string>) {
  const latestByStudent = new Map<number, TargetPhaseRow['submissions'][number]>()
  for (const s of p.submissions) {
    const prev = latestByStudent.get(s.studentId)
    if (!prev || s.attempt > prev.attempt) latestByStudent.set(s.studentId, s)
  }
  const latest = [...latestByStudent.values()]

  let alreadyCanonical = 0
  let blank = 0
  const rewrites: { submissionId: number; canonical: string; sourceText: string }[] = []
  const unmatched: UnmatchedAnswer[] = []
  const byText = new Map<string, { count: number; matchedOption: string | null }>()
  for (const s of latest) {
    const text = s.recitedText ?? ''
    const hit = text.trim() ? byNorm.get(normalizeAnswer(text)) : undefined
    // 空白作答不入 unmatched:评分页的「未归票作答」工作台只列非空文本(没内容就没得
    // 比对归票),报告若把空白算进「待人工」,老师会去找一条根本不存在的行(复查 R15)。
    if (text.trim() === '') blank++
    else if (hit == null) unmatched.push({ submissionId: s.id, studentNo: s.student?.studentNo ?? '', studentName: s.student?.name ?? '', text })
    else if (text === hit) alreadyCanonical++
    else rewrites.push({ submissionId: s.id, canonical: hit, sourceText: text })
    const key = text.trim()
    const e = byText.get(key) ?? { count: 0, matchedOption: hit ?? null }
    e.count++
    byText.set(key, e)
  }
  const report: UnifyTargetReport = {
    className: p.assignment.offering.class.name,
    assignmentId: p.assignment.id,
    phaseId: p.id,
    total: latest.length,
    alreadyCanonical,
    autoMatched: rewrites.length,
    unmatched,
    blank,
    answers: [...byText.entries()].map(([text, e]) => ({ text, ...e })).sort((a, b) => b.count - a.count),
    pendingReview: p.submissions.filter((s) => s.needsReview).length,
    scored: p.submissions.filter((s) => s.finalScore != null).length,
  }
  return { phase: p, rewrites, report }
}

// 执行计划(每个目标班一组)。写入顺序是可重跑性的关键(D1 无跨语句事务,复查 R3):
// 环节改型是「提交点」,必须放最后——一旦某班在中途失败,该班环节仍是默写型,重跑时
// 会再次被识别为目标并从头补齐;若改型先写,重跑会把半成品班误判为已完成而跳过
// (幽灵待批 + 残留任务写分)。故:①先撤评阅任务(阻断 AI 回写)→ ②等价作答规范化
// (改写可逆:原始写法留痕 voteSourceText)→ ③清复核 → ④最后改型。每步幂等。
async function applyPlans(prisma: PrismaClient, plans: ReturnType<typeof buildPlan>[], choicesJson: string, phaseOrder: number) {
  for (const { phase, rewrites } of plans) {
    await cancelPendingForSubmissions(prisma, phase.submissions.map((s) => s.id))
    for (const r of rewrites) await submissions.setPollAnswer(prisma, r.submissionId, r.canonical, r.sourceText)
    await submissions.clearNeedsReviewForPhase(prisma, phase.id)
    await assignments.convertPhaseToPoll(prisma, phase.id, phase.assignment.id, phaseOrder === 1, choicesJson)
  }
}

// title + phaseOrder 自发现:已是单选投票的班作模板(选项须一致),默写文本的班作目标。
// apply=false 只出报告、零写入;apply=true 执行改型 + 规范化改写 + needsReview 清理 +
// 取消挂起评阅任务(幂等:已改型的班会归入模板侧,重跑目标为空)。
export async function unifyPhaseToPoll(prisma: PrismaClient, schoolId: number, title: string, phaseOrder: number, apply: boolean): Promise<UnifyReport> {
  const phases = await assignments.listPhaseGroupForUnify(prisma, schoolId, title, phaseOrder)
  if (phases.length === 0) return { ok: false, error: `no phases found for title=${JSON.stringify(title)} order=${phaseOrder}` }

  const isPollTemplate = (p: (typeof phases)[number]) =>
    p.requireChoice && !p.multiChoice && !p.correctChoice && parseChoices(p.choicesJson).length >= 2

  const templates = phases.filter(isPollTemplate)
  const targets = phases.filter((p) => !isPollTemplate(p) && isTextTargetPhase(p))
  const skipped = phases
    .filter((p) => !isPollTemplate(p) && !isTextTargetPhase(p))
    .map((p) => ({ className: p.assignment.offering.class.name, reason: `unexpected config (itemType=${p.itemType})` }))

  if (templates.length === 0) return { ok: false, error: 'no single-choice poll template phase found in this group' }

  // 所有模板班的选项必须一致(归一化逐项比对),否则「统一」无从谈起。
  const canonical = parseChoices(templates[0].choicesJson)
  const canonKey = canonical.map(normalizeAnswer).join('\u0000')
  for (const tpl of templates) {
    if (parseChoices(tpl.choicesJson).map(normalizeAnswer).join('\u0000') !== canonKey) {
      return { ok: false, error: 'template poll phases disagree on their options — unify those first' }
    }
  }
  const byNorm = new Map(canonical.map((c) => [normalizeAnswer(c), c]))

  const plans = targets.map((p) => buildPlan(p, byNorm))

  // 约定校验:目标班环节应无任何评分。有分说明前提不成立——拒绝执行,报告里可见是哪班。
  if (apply && plans.some((x) => x.report.scored > 0)) {
    return { ok: false, error: 'refusing to apply: some target submissions carry scores (expected none) — re-run dry-run to see which classes' }
  }

  if (apply) await applyPlans(prisma, plans, templates[0].choicesJson ?? JSON.stringify(canonical), phaseOrder)

  return {
    ok: true,
    applied: apply,
    options: canonical,
    templateClasses: templates.map((p) => p.assignment.offering.class.name),
    skipped,
    targets: plans.map((x) => x.report),
  }
}

// 老师自助版「统一其它班到本投票环节」:以老师当前所在的单选投票环节为模板,把兄弟作业
// (同批次或同课程同标题、不同班,本人 scope)同序的「默写文本」环节统一改型为同一份投票。
// 与维护端点同一套计划/执行核心;错误返回 i18n key(action 层翻译)。apply=false 仅预览。
export async function unifyPollSiblings(
  prisma: PrismaClient,
  schoolId: number | null | undefined,
  userId: number,
  role: Role,
  phaseId: number,
  apply: boolean,
): Promise<UnifyReport> {
  const source = await assignments.findPhaseForUnifySource(prisma, phaseId, schoolId, userId, role)
  if (!source) return { ok: false, error: 'err.subNoAccess' }
  // 模板必须是纯单选投票(无正确答案):有答案键的单选属客观判分题,改型会牵出补判分,不在此功能范围。
  const canonical = parseChoices(source.choicesJson)
  if (!source.requireChoice || source.multiChoice || source.correctChoice || canonical.length < 2) {
    return { ok: false, error: 'err.pollUnifySource' }
  }
  const byNorm = new Map(canonical.map((c) => [normalizeAnswer(c), c]))

  const siblings = await assignments.listSiblingPhasesForUnify(
    prisma,
    { assignmentId: source.assignment.id, order: source.order, courseId: source.assignment.offering.courseId, classId: source.assignment.offering.classId, batchId: source.assignment.batchId, title: source.assignment.title },
    schoolId,
    userId,
    role,
  )
  const targets = siblings.filter(isTextTargetPhase)
  const skipped = siblings
    .filter((p) => !isTextTargetPhase(p) && !(p.requireChoice && !p.multiChoice))
    .map((p) => ({ className: p.assignment.offering.class.name, reason: p.itemType ?? 'unknown' }))

  const plans = targets.map((p) => buildPlan(p, byNorm))
  if (apply && plans.some((x) => x.report.scored > 0)) return { ok: false, error: 'err.pollUnifyScored' }
  if (apply) await applyPlans(prisma, plans, source.choicesJson ?? JSON.stringify(canonical), source.order)

  return {
    ok: true,
    applied: apply,
    options: canonical,
    templateClasses: [],
    skipped,
    targets: plans.map((x) => x.report),
  }
}

export type AssignVoteResult = { ok: true; assignmentId: number } | { ok: false; error: string }

// 人工归票:老师在评分页把一份「未归票作答」(与任何选项不符的原文)比对确认后归到某个
// 选项——把 recitedText 改写为选项规范原文,票数分布即计入;原文存 voteSourceText 留痕
// (再次改票不覆盖首次留痕,撤销恢复的永远是学生的原始作答)。仅限单选类投票环节,选项
// 必须合法;staff scope 由 findForStaff 把关。
export async function assignPollVote(prisma: PrismaClient, schoolId: number | null | undefined, userId: number, role: Role, submissionId: number, choice: string): Promise<AssignVoteResult> {
  const sub = await submissions.findForStaff(prisma, submissionId, schoolId, userId, role)
  if (!sub || !sub.phase) return { ok: false, error: 'err.subNoAccess' }
  if (!sub.phase.requireChoice || sub.phase.multiChoice) return { ok: false, error: 'err.subNoAccess' }
  // 有正确答案的单选是客观判分题(quiz),不是投票:人工改写作答不会重跑判分,
  // 会让 答案/正确率/分数 互相矛盾——归票仅限纯投票(复查 R8)。
  if ((sub.phase.correctChoice ?? '').trim() !== '') return { ok: false, error: 'err.pollOnlyAssign' }
  const options = parseChoices(sub.phase.choicesJson)
  if (!options.includes(choice)) return { ok: false, error: 'err.badChoice' }
  const current = sub.recitedText ?? ''
  const source = sub.voteSourceText ?? (current !== choice ? current : null)
  await submissions.setPollAnswer(prisma, sub.id, choice, source)
  return { ok: true, assignmentId: sub.assignmentId }
}

// 批量归票:一组相同作答的提交一次归到同一选项(工作台按文本聚合后的整组操作)。
// 整体校验:每个 id 都在本人 scope 内(缺一整体拒绝、零写入),都是单选类投票环节,
// 选项对每份提交的环节都合法;每份各自留痕自己的原文(与单条归票同规则)。
export async function assignPollVotesBulk(prisma: PrismaClient, schoolId: number | null | undefined, userId: number, role: Role, submissionIds: number[], choice: string): Promise<AssignVoteResult> {
  const ids = [...new Set(submissionIds)].filter((n) => Number.isInteger(n) && n > 0)
  if (ids.length === 0) return { ok: false, error: 'err.subNoAccess' }
  const rows = await submissions.listPollAssignables(prisma, ids, schoolId, userId, role)
  if (rows.length !== ids.length) return { ok: false, error: 'err.subNoAccess' }
  for (const r of rows) {
    if (!r.phase || !r.phase.requireChoice || r.phase.multiChoice) return { ok: false, error: 'err.subNoAccess' }
    // quiz(有答案键)不接受人工归票——同 assignPollVote 的理由(复查 R8)。
    if ((r.phase.correctChoice ?? '').trim() !== '') return { ok: false, error: 'err.pollOnlyAssign' }
    if (!parseChoices(r.phase.choicesJson).includes(choice)) return { ok: false, error: 'err.badChoice' }
  }
  for (const r of rows) {
    const current = r.recitedText ?? ''
    const source = r.voteSourceText ?? (current !== choice ? current : null)
    await submissions.setPollAnswer(prisma, r.id, choice, source)
  }
  return { ok: true, assignmentId: rows[0].assignmentId }
}

// 撤销归票:作答恢复为留痕的原文、清掉留痕,该票随即退出票数分布(回到「未归票作答」)。
export async function unassignPollVote(prisma: PrismaClient, schoolId: number | null | undefined, userId: number, role: Role, submissionId: number): Promise<AssignVoteResult> {
  const sub = await submissions.findForStaff(prisma, submissionId, schoolId, userId, role)
  if (!sub || !sub.phase) return { ok: false, error: 'err.subNoAccess' }
  // 环节若已被配上答案键(quiz),撤销归票同样会绕过判分——一并拒绝(复查 R8)。
  if ((sub.phase.correctChoice ?? '').trim() !== '') return { ok: false, error: 'err.pollOnlyAssign' }
  if (sub.voteSourceText == null) return { ok: false, error: 'err.noVoteSource' }
  await submissions.revertPollAnswer(prisma, sub.id, sub.voteSourceText)
  return { ok: true, assignmentId: sub.assignmentId }
}
