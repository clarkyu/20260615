// Assignment orchestration: publish (to one or more offerings, optionally from a
// bank set), edit, and the "weakest sentence" review generator. Free of auth/i18n/
// Next plumbing — errors are i18n keys, navigation targets are returned.

import type { PrismaClient, Role } from '@prisma/client'
import * as assignments from '@/lib/repo/assignments'
import * as offerings from '@/lib/repo/offerings'
import * as bank from '@/lib/repo/bank'
import * as submissions from '@/lib/repo/submissions'
import { weakSentences, latestPhaseSubmissions } from '@/lib/domain/analytics'
import type { AssignmentMeta, PhaseInput, SentenceRow } from '@/lib/repo/assignments'

export type { AssignmentMeta }

// One phase as the teacher authored it, before its content is resolved. `useBankSet`
// means "this phase's sentences (and shadow video) come from the published bank set";
// otherwise the typed sentence list is used.
export interface PhaseDraft {
  id: number | null // existing phase id (edit) — null for a newly added phase
  title: string | null
  category: string | null
  instructions: string | null
  useBankSet: boolean
  typedSentences: string[]
  openAt: Date | null
  dueAt: Date | null
  requireEyesClosed: boolean
  requireText: boolean
  requireAudio: boolean
  requireVideo: boolean
  requireHandwriting: boolean
  // 新提交类型（可选，旧 draft 省略即 false/null）：单选投票 / 多选 / 自由文本。
  requireChoice?: boolean
  choicesJson?: string | null
  correctChoice?: string | null
  multiChoice?: boolean
  correctChoices?: string | null
  fillBlank?: boolean
  blanksJson?: string | null
  requireFreeText?: boolean
  // 每环节批阅配置（可选，空=跟随作业/平台默认）。
  rubric?: string | null
  perceptionModel?: string | null
  judgeModel?: string | null
  graded: boolean
  maxAttempts: number
  // 该环节在作业总分里的相对权重（≥1）；默认 1 = 等权。
  weight: number
  isFormalTest: boolean
  freePractice: boolean
}

function hasSubmitKind(p: PhaseDraft): boolean {
  return p.requireText || p.requireAudio || p.requireVideo || p.requireHandwriting || !!p.requireChoice || !!p.requireFreeText || !!p.fillBlank
}

// Resolve every phase's content into ready-to-store PhaseInput[]: bank-set phases get
// the set's example sentences (中文 gloss) + shadow video; typed phases get their list.
// The bank set is loaded once. Returns an i18n error key on any invalid phase.
async function resolvePhases(
  prisma: PrismaClient,
  schoolId: number,
  drafts: PhaseDraft[],
  chunkSetId: number | null,
): Promise<{ ok: true; phases: PhaseInput[] } | { ok: false; error: string }> {
  if (drafts.length === 0) return { ok: false, error: 'err.needPhase' }

  let bankSentences: SentenceRow[] | null = null
  let bankVideoKey: string | null = null
  if (chunkSetId && drafts.some((d) => d.useBankSet)) {
    const set = await bank.findWithChunksVisible(prisma, chunkSetId, schoolId)
    if (!set) return { ok: false, error: 'err.setNotFound' }
    bankVideoKey = set.shadowVideoKey
    // The example sentence is what the student reads aloud / shadows; carry its 中文.
    bankSentences = set.chunks.map((c, i) => ({ order: i + 1, text: c.exampleEn || c.english, translation: c.exampleZh || c.chinese }))
  }

  const phases: PhaseInput[] = []
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i]
    if (!hasSubmitKind(d)) return { ok: false, error: 'err.needSubmitKind' }
    const fromBank = d.useBankSet && bankSentences
    const sentences: SentenceRow[] = fromBank
      ? bankSentences!.map((s) => ({ ...s }))
      : d.typedSentences.map((text, j) => ({ order: j + 1, text, translation: null }))
    phases.push({
      id: d.id,
      order: i + 1,
      title: d.title,
      category: d.category,
      instructions: d.instructions,
      chunkSetId: fromBank ? chunkSetId : null,
      shadowVideoKey: fromBank ? bankVideoKey : null,
      openAt: d.openAt,
      dueAt: d.dueAt,
      requireEyesClosed: d.requireEyesClosed,
      requireText: d.requireText,
      requireAudio: d.requireAudio,
      // 正式测试必须真实录像——即使老师没勾视频，也强制要求，杜绝只交文字蒙混。
      requireVideo: d.requireVideo || d.isFormalTest,
      requireHandwriting: d.requireHandwriting,
      requireChoice: d.requireChoice ?? false,
      choicesJson: d.choicesJson ?? null,
      correctChoice: d.correctChoice ?? null,
      multiChoice: d.multiChoice ?? false,
      correctChoices: d.correctChoices ?? null,
      fillBlank: d.fillBlank ?? false,
      blanksJson: d.blanksJson ?? null,
      requireFreeText: d.requireFreeText ?? false,
      rubric: d.rubric ?? null,
      perceptionModel: d.perceptionModel ?? null,
      judgeModel: d.judgeModel ?? null,
      graded: d.graded,
      maxAttempts: d.maxAttempts,
      weight: Math.max(1, Math.round(d.weight || 1)),
      isFormalTest: d.isFormalTest,
      // 自由练习只在「仅练习不计分」时成立——计分环节不能放任不限次数/不批阅。
      freePractice: d.freePractice && !d.graded,
      sentences,
    })
  }
  return { ok: true, phases }
}

export type CreateResult = { ok: true; redirectTo: string } | { ok: false; error: string }

// Publish one assignment per selected offering, each with an ordered list of phases.
// When a phase `useBankSet`, its sentences + shadow video come from the published set.
export async function createAssignments(
  prisma: PrismaClient,
  schoolId: number,
  userId: number,
  role: Role,
  meta: AssignmentMeta,
  phaseDrafts: PhaseDraft[],
  offeringIds: number[],
  chunkSetId: number | null,
  primaryOfferingId: number | null,
  // Client-generated idempotency key (one per publish form). Omitted → a server-side one is
  // minted (no idempotency, matching the old behavior).
  clientBatchId?: string,
): Promise<CreateResult> {
  if (offeringIds.length === 0) return { ok: false, error: 'err.needPublishTarget' }
  // Teacher-scoped: a teacher can only publish to their OWN offerings.
  const validIds = await offerings.findIdsForSchool(prisma, offeringIds, schoolId, userId, role)
  if (validIds.length === 0) return { ok: false, error: 'err.offeringNotFound' }

  const resolved = await resolvePhases(prisma, schoolId, phaseDrafts, chunkSetId)
  if (!resolved.ok) return { ok: false, error: resolved.error }

  // One standalone create per offering (no $transaction: D1 can't resolve the new
  // assignment's auto-increment id for its nested phase/sentence inserts in a batch).
  // All classes published together share one batchId, so a later per-phase 评阅配置
  // change can be synced to the whole batch (发布后改一次评分标准 → 同步到同批次班级).
  const batchId = clientBatchId || crypto.randomUUID()
  // Idempotent publish: a double-clicked / retried submit reuses the same client batchId,
  // so skip any offering already created for it — otherwise each retry mints a fresh set of
  // student-facing assignments the teacher then has to delete.
  const already = clientBatchId ? await assignments.offeringsWithBatch(prisma, batchId, validIds) : new Set<number>()
  for (const offeringId of validIds) {
    if (already.has(offeringId)) continue
    await assignments.createWithPhases(prisma, offeringId, meta, resolved.phases, batchId)
  }

  // Return to the offering the teacher started from, if it was among the targets.
  const target = primaryOfferingId && validIds.includes(primaryOfferingId) ? primaryOfferingId : validIds[0]
  return { ok: true, redirectTo: `/dashboard/teaching/${target}` }
}

export type UpdateResult = { ok: true } | { ok: false; error: string }

export async function updateAssignment(
  prisma: PrismaClient,
  schoolId: number,
  userId: number,
  role: Role,
  assignmentId: number,
  meta: AssignmentMeta,
  phaseDrafts: PhaseDraft[],
  chunkSetId: number | null,
  // The phase ids the edit form ORIGINALLY loaded. Used to reconcile deletions safely: a
  // phase added concurrently (not in this set) is preserved, never cascade-deleted by a
  // stale save. See repo.updateWithPhases (audit P2-9).
  knownPhaseIds: readonly number[],
): Promise<UpdateResult> {
  const existing = await assignments.findForSchool(prisma, assignmentId, schoolId, userId, role)
  if (!existing) return { ok: false, error: 'err.assignNotFound' }

  const resolved = await resolvePhases(prisma, schoolId, phaseDrafts, chunkSetId)
  if (!resolved.ok) return { ok: false, error: resolved.error }

  await assignments.updateWithPhases(prisma, assignmentId, meta, resolved.phases, knownPhaseIds)
  return { ok: true }
}

// 学情 → 行动：把一个授课里"最弱的句子"生成一份复习作业。Returns where to go next
// (the new assignment's edit page, or insights when there's nothing weak yet).
export async function buildReviewAssignment(prisma: PrismaClient, offeringId: number): Promise<{ redirectTo: string }> {
  const list = await assignments.listWithSentencesForOffering(prisma, offeringId)
  // Keyed per (assignment, phase, order): sentence orders repeat across phases.
  const textByKey = new Map<string, { text: string; translation: string | null }>()
  for (const a of list) for (const s of a.sentences) textByKey.set(`${a.id}:${s.phaseId ?? 0}:${s.order}`, { text: s.text, translation: s.translation })

  const phaseRows = latestPhaseSubmissions(await submissions.listForOfferingLatestFirst(prisma, offeringId))

  const picked: SentenceRow[] = []
  const used = new Set<string>()
  for (const w of weakSentences(phaseRows, 12)) {
    const e = textByKey.get(`${w.assignmentId}:${w.phaseId ?? 0}:${w.order}`)
    if (e && !used.has(e.text)) {
      used.add(e.text)
      picked.push({ order: picked.length + 1, text: e.text, translation: e.translation })
    }
  }
  if (picked.length === 0) return { redirectTo: `/dashboard/teaching/${offeringId}/insights` }

  const d = new Date()
  const created = await assignments.createReview(prisma, offeringId, `复习 · 薄弱句 ${d.getMonth() + 1}-${d.getDate()}`, picked)
  return { redirectTo: `/dashboard/assignments/${created.id}/edit` }
}
