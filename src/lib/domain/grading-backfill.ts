// 评阅补登(一次性维护,期末考核复盘):
//
// AI 文本评分(writing 任务)上线晚于一批已提交的默写/自由文本作答——提交时没有任何
// 代码给它们建评阅任务(队列里 kind='writing' 的任务数为 0),这批行一直以「已上传+
// 待复核」躺在老师队列里。本模块按 学校+标题 圈定作业,把符合条件的行批量补进耐久
// 评阅队列;顺带清掉纯投票环节上的幽灵复核标记(投票不复核,历史遗留虚增看板待批数)。
//
// 与 unify-poll-phase 同款约定:默认 dry-run 零写入,apply 才执行;幂等(重跑时已入队
// 的重置、已清的不再计数);评阅本身仍走耐久队列的既有围栏(objective 自弃、GRADED
// 不覆盖、老师分优先),补登只负责「把任务放进队列」。

import type { PrismaClient, SubmissionStatus } from '@prisma/client'
import * as submissions from '@/lib/repo/submissions'
import * as assignments from '@/lib/repo/assignments'
import { probeObject, type ObjectHealth } from '@/lib/storage'
import { enqueueGradingBulk, kickDrain, deleteJobsForSubmissions } from './jobs'

export type BackfillReport =
  | {
      ok: true
      applied: boolean
      // 写作补评候选(按作业分布,供核对「是不是预期的那批」)
      writingCandidates: number
      perAssignment: { assignmentId: number; count: number }[]
      // apply 时的实际写入;dry-run 为 0
      jobsCreated: number
      jobsReset: number
      // 纯投票环节的幽灵复核标记(dry-run 报数量,apply 报清掉的数量)
      ghostReview: number
    }
  | { ok: false; error: string }

export async function backfillWritingGrading(prisma: PrismaClient, schoolId: number, title: string, apply: boolean): Promise<BackfillReport> {
  const rows = await submissions.listWritingBackfillCandidates(prisma, schoolId, title)
  const ghostCount = await submissions.countGhostPollReview(prisma, schoolId, title)
  if (rows.length === 0 && ghostCount === 0) return { ok: false, error: 'nothing to backfill for this school+title' }

  const byAssignment = new Map<number, number>()
  for (const r of rows) byAssignment.set(r.assignmentId, (byAssignment.get(r.assignmentId) ?? 0) + 1)
  const perAssignment = [...byAssignment.entries()].map(([assignmentId, count]) => ({ assignmentId, count })).sort((a, b) => a.assignmentId - b.assignmentId)

  if (!apply) {
    return { ok: true, applied: false, writingCandidates: rows.length, perAssignment, jobsCreated: 0, jobsReset: 0, ghostReview: ghostCount }
  }

  const { created, reset } = await enqueueGradingBulk(prisma, rows.map((r) => r.id), 'writing')
  const cleared = await submissions.clearGhostPollReview(prisma, schoolId, title)
  // 响应后踢一脚排空;队列大头交给 5 分钟一班的 cron drain 消化。
  await kickDrain()
  return { ok: true, applied: true, writingCandidates: rows.length, perAssignment, jobsCreated: created, jobsReset: reset, ghostReview: cleared.count }
}

// ── 媒体重评(期末考核修复 ③) ────────────────────────────────────────────────
//
// 媒体探针证实:449 份「评阅失败/卡死/未评」的视频里 98% 的对象完好——历史 404 是
// 暂时性取件失败,不是数据丢失。本函数把这批行的评阅任务批量重置入队(kind
// 'submission',重跑=重置)。卡在 PROCESSING 的行不用单独解套:claimForProcessing
// 现在会接管过期的 PROCESSING(claim 陷阱已修),重评任务跑到它们时自然接管。
// 真正缺失/空文件的少数行会在评前预检下快速走到「评阅失败」,老师人工处理。

export type RequeueReport =
  | {
      ok: true
      applied: boolean
      targets: number
      perPhaseOrder: { phaseOrder: number; count: number }[]
      jobsCreated: number
      jobsReset: number
    }
  | { ok: false; error: string }

export async function requeueMediaGrading(prisma: PrismaClient, schoolId: number, title: string, apply: boolean): Promise<RequeueReport> {
  // 整段媒体重评口径:视频**或音频**皆算(listMediaGradeTargets)。探测(probe)只认视频、单用
  // listMediaProbeTargets;重排要连纯音频朗读/背诵一起捞,否则那类音频提交永远无端点可评。
  const ids: number[] = []
  const byPhase = new Map<number, number>()
  let after = 0
  for (;;) {
    const rows = await submissions.listMediaGradeTargets(prisma, schoolId, title, after, 500)
    for (const r of rows) {
      ids.push(r.id)
      const order = r.phase?.order ?? 0
      byPhase.set(order, (byPhase.get(order) ?? 0) + 1)
    }
    if (rows.length < 500) break
    after = rows[rows.length - 1].id
  }
  if (ids.length === 0) return { ok: false, error: 'no requeue targets for this school+title' }
  const perPhaseOrder = [...byPhase.entries()].map(([phaseOrder, count]) => ({ phaseOrder, count })).sort((a, b) => a.phaseOrder - b.phaseOrder)

  if (!apply) return { ok: true, applied: false, targets: ids.length, perPhaseOrder, jobsCreated: 0, jobsReset: 0 }

  const { created, reset } = await enqueueGradingBulk(prisma, ids, 'submission')
  await kickDrain()
  return { ok: true, applied: true, targets: ids.length, perPhaseOrder, jobsCreated: created, jobsReset: reset }
}

// ── 逐句跟读重评(清扫盲区补漏) ────────────────────────────────────────────────
//
// requeueMediaGrading 只认 videoKey/audioKey,对逐句跟读(shadow)完全瞎——它们的音频在
// ShadowTake 行里。于是一批真背诵(期末收官时发现 163 份、8150 条逐句音频)评阅失败后进了
// 死信,却从没被重评工具捞到过。本函数按 school+title 圈定「有 ShadowTake、失败/卡死/未评」
// 的 shadow 提交,重置成 kind='shadow' 入队(重跑=重置)。与 requeueMediaGrading 同款约定:
// 默认 dry-run 零写入,apply 才执行;幂等;GRADED/无录音不碰。
export async function requeueShadowGrading(prisma: PrismaClient, schoolId: number, title: string, apply: boolean): Promise<RequeueReport> {
  const ids: number[] = []
  const byPhase = new Map<number, number>()
  let after = 0
  for (;;) {
    const rows = await submissions.listShadowGradingTargets(prisma, schoolId, title, after, 500)
    for (const r of rows) {
      ids.push(r.id)
      const order = r.phase?.order ?? 0
      byPhase.set(order, (byPhase.get(order) ?? 0) + 1)
    }
    if (rows.length < 500) break
    after = rows[rows.length - 1].id
  }
  if (ids.length === 0) return { ok: false, error: 'no shadow requeue targets for this school+title' }
  const perPhaseOrder = [...byPhase.entries()].map(([phaseOrder, count]) => ({ phaseOrder, count })).sort((a, b) => a.phaseOrder - b.phaseOrder)

  if (!apply) return { ok: true, applied: false, targets: ids.length, perPhaseOrder, jobsCreated: 0, jobsReset: 0 }

  const { created, reset } = await enqueueGradingBulk(prisma, ids, 'shadow')
  await kickDrain()
  return { ok: true, applied: true, targets: ids.length, perPhaseOrder, jobsCreated: created, jobsReset: reset }
}

// ── 写作(writing)重评(清死信盲区补漏) ────────────────────────────────────────────
//
// backfillWritingGrading 只捞「从没入过队」的 writing 行(UPLOADED/FLAGGED 且无 AI 分),已入过队又
// 死信/卡死的 writing 任务它一个都碰不到;requeueMediaGrading/requeueShadowGrading 又都只认媒体键。
// 于是一批文本作答评阅失败进死信后,没有任何重评工具能捞它们回来。本函数按 school+title 圈定「有文本、
// writing 评阅任务失败/卡死/未评」的提交,重置成 kind='writing' 入队(重跑=重置)。与另外两个重评
// 同款约定:默认 dry-run 零写入,apply 才执行;幂等;评阅本身仍走队列既有围栏(GRADED 不覆盖、老师分优先)。
export async function requeueWritingGrading(prisma: PrismaClient, schoolId: number, title: string, apply: boolean): Promise<RequeueReport> {
  const ids: number[] = []
  const byPhase = new Map<number, number>()
  let after = 0
  for (;;) {
    const rows = await submissions.listWritingRequeueTargets(prisma, schoolId, title, after, 500)
    for (const r of rows) {
      ids.push(r.id)
      const order = r.phase?.order ?? 0
      byPhase.set(order, (byPhase.get(order) ?? 0) + 1)
    }
    if (rows.length < 500) break
    after = rows[rows.length - 1].id
  }
  if (ids.length === 0) return { ok: false, error: 'no writing requeue targets for this school+title' }
  const perPhaseOrder = [...byPhase.entries()].map(([phaseOrder, count]) => ({ phaseOrder, count })).sort((a, b) => a.phaseOrder - b.phaseOrder)

  if (!apply) return { ok: true, applied: false, targets: ids.length, perPhaseOrder, jobsCreated: 0, jobsReset: 0 }

  const { created, reset } = await enqueueGradingBulk(prisma, ids, 'writing')
  await kickDrain()
  return { ok: true, applied: true, targets: ids.length, perPhaseOrder, jobsCreated: created, jobsReset: reset }
}

// ── 廉价重评(评分标准更新后:感知不重跑,只重判) ──────────────────────────────────────
//
// 评分个性化落地后要按新标准重评一个环节。贵的感知(视频,~16×)不该重跑:已定稿时 perceptionJson
// 被清空(#400),但完整感知仍留在 aiResult 里——本函数把它拷回 perceptionJson,再把 status 置回
// UPLOADED 重新入队。重评跑到时复用缓存感知、只重跑几分钱的 judge(带上新 rubric + 本人文本参照 +
// 合规±10,全在 PR-1 的评阅路径里)。老师已改分的行不动(尊重终评)。writing 环节没有感知,直接重判。
//
// 与其它维护端点同款:默认 dry-run 报总盘子 + 本批,apply 才写;分批(每次 REGRADE_BATCH 行,
// 处理过的移出谓词)——more=true 就再 apply 一次续,直到排空;幂等。
const REGRADE_BATCH = 100

export type RegradeReport =
  | {
      ok: true
      applied: boolean
      total: number     // 全部待重评数(dry-run 即见总盘子)
      scanned: number   // 本批处理数
      more: boolean     // 还有没排空的(再 apply 一次续)
      restored: number  // 本批从 aiResult 恢复了感知缓存的行数(writing 环节恒 0)
      requeued: number  // 本批重新入队的评阅任务数
      kind: string      // 'submission'（整段媒体）| 'writing'（文本）
      sampleIds: number[]
    }
  | { ok: false; error: string }

export async function regradePhase(prisma: PrismaClient, schoolId: number, title: string, order: number, apply: boolean, limit?: number): Promise<RegradeReport> {
  // 环节类型定评阅任务种类:writing→文本判分;speech→整段媒体(感知+判分)。objective 不评。
  const phases = await assignments.findPhaseRubricTargets(prisma, schoolId, title, order)
  if (phases.length === 0) return { ok: false, error: 'no phase at this school+title+order' }
  if (phases[0].itemType === 'objective') return { ok: false, error: 'objective phase is not AI-graded — nothing to regrade' }
  // 评阅任务种类:writing→文本判分;逐句跟读(有 ShadowTake)→shadow(走 gradeShadowSubmission,
  // 复用逐句缓存重评);否则整段媒体→submission(感知+判分)。itemType 区分不了 shadow,靠硬信号判。
  const kind: 'submission' | 'writing' | 'shadow' =
    phases[0].itemType === 'writing' ? 'writing' : (await submissions.phaseHasShadowTakes(prisma, schoolId, title, order)) ? 'shadow' : 'submission'

  const total = await submissions.countRegradeTargets(prisma, schoolId, title, order)
  if (total === 0) return { ok: false, error: 'no finalized (non-teacher-graded) submissions to regrade for this school+title+order' }

  // 试点旋钮:limit 可把本批压到更小(先小规模重评、与快照对比、再定全量)。上限仍是 REGRADE_BATCH,
  // 免得一次太多顶穿子请求/时限。省略 = 满批。
  const take = limit != null ? Math.max(1, Math.min(limit, REGRADE_BATCH)) : REGRADE_BATCH
  const rows = await submissions.listRegradeTargets(prisma, schoolId, title, order, take)
  const sampleIds = rows.slice(0, 20).map((r) => r.id)
  if (!apply) return { ok: true, applied: false, total, scanned: rows.length, more: total > rows.length, restored: 0, requeued: 0, kind, sampleIds }

  let restored = 0
  const ids: number[] = []
  for (const row of rows) {
    ids.push(row.id)
    let perceptionJson: string | null = null
    // 已定稿会清空 perceptionJson(#400),但完整感知仍在 aiResult 里——拷回缓存,重评复用、只重判。
    if (!row.perceptionJson && row.aiResult) {
      try {
        const r = JSON.parse(row.aiResult) as { perceptionModel?: string; perception?: unknown }
        if (r?.perception) {
          perceptionJson = JSON.stringify({ perceptionModel: r.perceptionModel, perception: r.perception })
          restored++
        }
      } catch { /* aiResult 损坏 → 不写缓存,重评会重新感知(仍正确,只是贵一次) */ }
    }
    // 回退安全网:首次重置捕获旧评分态快照;已有(此前重评过)则沿用,保住"最初"那份不被覆盖。
    const snapshot = row.regradeSnapshot ?? JSON.stringify({
      status: row.status, finalScore: row.finalScore, aiScore: row.aiScore,
      feedback: row.feedback, needsReview: row.needsReview, aiResult: row.aiResult,
    })
    await submissions.resetForRegrade(prisma, row.id, perceptionJson, snapshot)
  }
  const { created, reset } = await enqueueGradingBulk(prisma, ids, kind)
  await kickDrain()
  return { ok: true, applied: true, total, scanned: rows.length, more: total > rows.length, restored, requeued: created + reset, kind, sampleIds }
}

// ── 采纳 AI 评阅结果定稿一个环节(含 FLAGGED) ─────────────────────────────────────
//
// 把某环节「待复核(needsReview,含 FLAGGED 防作弊 + 低置信)且有 AI 分」的提交一次性定稿为已评,
// finalScore 取 COALESCE(老师分, AI 分)。clark 期末环节4 决定:录制违规的合规已按"只奖不罚"并入
// AI 分(#425)——254 份 FLAGGED 里 253 只是"录制窗口失焦"(移动端极易误触)、仅 13 份真偷看且已 −10,
// 不再需要逐份人工复核,老师复核与评分直接采纳 AI 评阅结果。与其它维护端点同款:schoolId+title+order
// 必填钉租户;默认 dry-run 报盘子(总数 + FLAGGED 占比),apply 才写;幂等(定稿后 needsReview=0 移出
// 谓词,重跑数 0);无待复核目标即拒(objective 环节无 AI 分,自然命中此拒)。
// 可退:这些行的重评快照仍在,restore-scores order=N 一键还原到重评前(会同时撤销本次定稿)。
export type AcceptAiReport =
  | {
      ok: true
      applied: boolean
      targets: number // 待复核且有 AI 分的总数(dry-run 即见)
      flagged: number // 其中 FLAGGED(防作弊)占比
      lowConfidence: number // 其中低置信 GRADED(= targets − flagged)
      finalized: number // apply 实际定稿的行数;dry-run 为 0
    }
  | { ok: false; error: string }

export async function acceptAiForPhase(prisma: PrismaClient, schoolId: number, title: string, order: number, apply: boolean): Promise<AcceptAiReport> {
  const phases = await assignments.findPhaseRubricTargets(prisma, schoolId, title, order)
  if (phases.length === 0) return { ok: false, error: 'no phase at this school+title+order' }
  const phaseIds = phases.map((p) => p.id)

  const targets = await submissions.countAcceptAiForPhase(prisma, phaseIds)
  if (targets === 0) return { ok: false, error: 'no pending-review AI-graded submissions to accept for this school+title+order' }
  const flagged = await submissions.countAcceptAiFlaggedForPhase(prisma, phaseIds)
  const lowConfidence = targets - flagged

  if (!apply) return { ok: true, applied: false, targets, flagged, lowConfidence, finalized: 0 }
  const finalized = await submissions.acceptAiForPhaseRows(prisma, phaseIds, new Date())
  return { ok: true, applied: true, targets, flagged, lowConfidence, finalized }
}

// ── 重评回退(安全网:一键还原到重评前) ────────────────────────────────────────────────
//
// regrade-phase 在首次重置每行前把旧评分态存进 regradeSnapshot。本函数据此把某环节被重评动过的行
// 全部还原成重评前的样子(status/finalScore/aiScore/feedback/needsReview/aiResult),清空快照,并作废
// 其重评任务。"看结果不满意就一键退回"靠这个。与其它维护端点同款:默认 dry-run 报总盘子 + 本批,
// apply 才写;分批(more=true 再 apply 续到排空);可选 limit;幂等(还原过的清了快照、移出谓词)。
export type RestoreReport =
  | { ok: true; applied: boolean; total: number; scanned: number; more: boolean; restored: number; sampleIds: number[] }
  | { ok: false; error: string }

export async function restoreScores(prisma: PrismaClient, schoolId: number, title: string, order: number, apply: boolean, limit?: number): Promise<RestoreReport> {
  const total = await submissions.countRestoreTargets(prisma, schoolId, title, order)
  if (total === 0) return { ok: false, error: 'no regrade snapshots for this school+title+order (nothing was regraded, or already restored)' }

  const take = limit != null ? Math.max(1, Math.min(limit, REGRADE_BATCH)) : REGRADE_BATCH
  const rows = await submissions.listRestoreTargets(prisma, schoolId, title, order, take)
  const sampleIds = rows.slice(0, 20).map((r) => r.id)
  if (!apply) return { ok: true, applied: false, total, scanned: rows.length, more: total > rows.length, restored: 0, sampleIds }

  const ids: number[] = []
  let restored = 0
  for (const row of rows) {
    if (!row.regradeSnapshot) continue
    try {
      const snap = JSON.parse(row.regradeSnapshot) as {
        status: SubmissionStatus; finalScore: number | null; aiScore: number | null
        feedback: string | null; needsReview: boolean; aiResult: string | null
      }
      await submissions.restoreScoreRow(prisma, row.id, {
        status: snap.status, finalScore: snap.finalScore, aiScore: snap.aiScore,
        feedback: snap.feedback, needsReview: snap.needsReview, aiResult: snap.aiResult,
      })
      ids.push(row.id)
      restored++
    } catch { /* 快照损坏 → 跳过,不误写(极少见,交人工) */ }
  }
  // 行已还原成 GRADED/FLAGGED,任何在途/待跑的重评任务作废。
  if (ids.length) await deleteJobsForSubmissions(prisma, ids)
  return { ok: true, applied: true, total, scanned: rows.length, more: total > rows.length, restored, sampleIds }
}

// ── 幽灵死信对账(看板对得上账 + 降老师负担) ────────────────────────────────────────
//
// 一份提交评过一次(拿到 aiScore、进 GRADED/FLAGGED),后来被批量重排、再评又失败到顶——提交
// 仍留着上次的分,评阅任务却停在 FAILED/PENDING,只虚增看板「失败/死信」数(就是「死信数 vs 失败
// 数对不上」的那种行),老师复核定稿也不清(applyTeacherOverride 不碰 GradingJob)。重评没意义
// (已有分)、归档缺交更错(有内容有分)——唯一正解:把任务对账成 DONE。默认 dry-run 报数,apply
// 才写;幂等(已 DONE 的下次不再入选);可反复跑当常备扫帚,新冒出来的幽灵随时清。title 选填:
// 传了按作业、不传全校对账。
export type ReconcileReport =
  | {
      ok: true
      applied: boolean
      targets: number
      perPhaseOrder: { phaseOrder: number; count: number }[]
      jobsDone: number
    }
  | { ok: false; error: string }

export async function reconcileGradedJobs(prisma: PrismaClient, schoolId: number, title: string | null, apply: boolean): Promise<ReconcileReport> {
  const ids: number[] = []
  const byPhase = new Map<number, number>()
  let after = 0
  for (;;) {
    const rows = await submissions.listGradedPhantomTargets(prisma, schoolId, title, after, 500)
    for (const r of rows) {
      ids.push(r.id)
      const order = r.phase?.order ?? 0
      byPhase.set(order, (byPhase.get(order) ?? 0) + 1)
    }
    if (rows.length < 500) break
    after = rows[rows.length - 1].id
  }
  if (ids.length === 0) return { ok: false, error: 'no graded-phantom grading jobs for this school(+title)' }
  const perPhaseOrder = [...byPhase.entries()].map(([phaseOrder, count]) => ({ phaseOrder, count })).sort((a, b) => a.phaseOrder - b.phaseOrder)

  if (!apply) return { ok: true, applied: false, targets: ids.length, perPhaseOrder, jobsDone: 0 }

  const jobsDone = await submissions.markGradingJobsDone(prisma, ids)
  return { ok: true, applied: true, targets: ids.length, perPhaseOrder, jobsDone }
}

// ── 上传坏死 / 内容损坏 自动归档(降老师负担) ──────────────────────────────────────
//
// 两类「有提交、却没有可评内容」的卡住/死信,重跑都是死循环,不该扔给老师人工:
//   ① 上传坏死:整段媒体或逐句音频对象缺失(404)/空(416,0 字节键空挂);
//   ② 内容损坏:对象在、有字节,但视频损坏、Gemini 无法解码(评阅 lastError 明确含 corrupt)——
//      探针只看「存在+非空」测不出,得靠评阅报错识别。
// 本函数按 school+title 圈定卡住/失败的提交,逐个探测媒体 + 看评阅报错,确认无可评内容的归档为缺交
// (MISSING)并删死信任务:随即落出看板的「失败/待批/已交」各计数(MISSING 全 codebase 当未提交处理),
// 老师零操作。
//
// 保守判定:媒体探针有一个 'ok' 且评阅报错非「损坏」——有可评内容,不碰(交给重评);夹杂 'unknown'
// (网络抖/5xx)判不准,不碰;写作类(有文本、非媒体)跳过。默认 dry-run 零写入,apply 才执行;
// 幂等(已 MISSING 的下次不再扫)。cap 60/次,more=true 表示还有,续跑即可。
async function probeAll(keys: string[], probe: (key: string) => Promise<ObjectHealth>, concurrency = 8): Promise<ObjectHealth[]> {
  const out: ObjectHealth[] = []
  for (let i = 0; i < keys.length; i += concurrency) {
    out.push(...(await Promise.all(keys.slice(i, i + concurrency).map(probe))))
  }
  return out
}

// Gemini 明确判定「视频损坏/无法解码」的签名:对象在、有字节,但内容不可用——AI 与人工都评不了,
// 与「空/缺」同处理。窄匹配 'corrupt'(Gemini 报错原文如 "The video is corrupt or ..."),避免误伤
// 瞬时错误(限流/网络)——那些该重试,不该归档。
function isUngradeableContentError(lastError: string | null | undefined): boolean {
  return !!lastError && lastError.toLowerCase().includes('corrupt')
}

export type ResolveMissingReport =
  | {
      ok: true
      applied: boolean
      scanned: number
      more: boolean
      missing: number // 归档为缺交的总条数(空/缺 + 损坏)
      emptyContent: number // 对象空/缺(上传坏死)
      corruptContent: number // 对象在但内容损坏(Gemini 解不了)
      byKind: Record<string, number>
      skippedHealthy: number // 有健康媒体,留给重评
      skippedUnknown: number // 探测判不准(网络抖/无键),保守不碰
      skippedWriting: number // 写作类:有文本,非媒体缺失
      sampleIds: number[]
    }
  | { ok: false; error: string }

export async function resolveMissingMedia(
  prisma: PrismaClient,
  schoolId: number,
  title: string,
  apply: boolean,
  probe: (key: string) => Promise<ObjectHealth> = probeObject,
): Promise<ResolveMissingReport> {
  const LIMIT = 60
  const rows = await submissions.listStuckGradingTargets(prisma, schoolId, title, LIMIT)
  if (rows.length === 0) return { ok: false, error: 'no stuck/failed grading submissions for this school+title' }

  const emptyIds: number[] = []   // 对象空/缺(上传坏死)
  const corruptIds: number[] = [] // 对象在但内容损坏(Gemini 解不了)
  const byKind: Record<string, number> = {}
  const bump = (kind: string) => { byKind[kind] = (byKind[kind] ?? 0) + 1 }
  let skippedHealthy = 0
  let skippedUnknown = 0
  let skippedWriting = 0
  for (const row of rows) {
    const kind = row.gradingJob?.kind ?? 'submission'
    if (kind === 'writing') { skippedWriting++; continue } // 有文本,不是媒体缺失/损坏
    const corruptErr = isUngradeableContentError(row.gradingJob?.lastError)
    const keys = kind === 'shadow'
      ? row.shadowTakes.map((t) => t.audioKey)
      : [row.videoKey, row.audioKey].filter((k): k is string => !!k)
    if (keys.length === 0) {
      // 没有键可探:评阅报「损坏」也算无可评内容;否则判不准,不碰。
      if (corruptErr) { corruptIds.push(row.id); bump(kind) } else skippedUnknown++
      continue
    }
    const healths = await probeAll(keys, probe)
    if (healths.every((h) => h === 'missing' || h === 'empty')) {
      emptyIds.push(row.id); bump(kind) // 全空/全缺:上传坏死
    } else if (corruptErr) {
      corruptIds.push(row.id); bump(kind) // 对象在但内容损坏(Gemini 解不了)
    } else if (healths.some((h) => h === 'ok')) {
      skippedHealthy++ // 有可评内容,别归档
    } else {
      skippedUnknown++ // 夹杂 'unknown'——保守不碰,交给下次或重评
    }
  }

  const allIds = [...emptyIds, ...corruptIds]
  const base = {
    scanned: rows.length,
    more: rows.length === LIMIT,
    missing: allIds.length,
    emptyContent: emptyIds.length,
    corruptContent: corruptIds.length,
    byKind,
    skippedHealthy,
    skippedUnknown,
    skippedWriting,
    sampleIds: allIds.slice(0, 20),
  }
  if (!apply || allIds.length === 0) return { ok: true, applied: false, ...base }

  if (emptyIds.length > 0) await submissions.markSubmissionsMissing(prisma, emptyIds, '录音/录像未成功上传（对象缺失或为空），系统已归档为缺交，无需老师处理。')
  if (corruptIds.length > 0) await submissions.markSubmissionsMissing(prisma, corruptIds, '视频/录像文件损坏、无法解码评阅，系统已归档为缺交，无需老师处理。')
  await deleteJobsForSubmissions(prisma, allIds)
  return { ok: true, applied: true, ...base }
}
