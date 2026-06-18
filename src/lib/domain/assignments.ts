// Assignment orchestration: publish (to one or more offerings, optionally from a
// bank set), edit, and the "weakest sentence" review generator. Free of auth/i18n/
// Next plumbing — errors are i18n keys, navigation targets are returned.

import type { PrismaClient } from '@prisma/client'
import * as assignments from '@/lib/repo/assignments'
import * as offerings from '@/lib/repo/offerings'
import * as bank from '@/lib/repo/bank'
import * as submissions from '@/lib/repo/submissions'
import { weakSentences, parsePerSentence, type AnalyticsSubmission } from '@/lib/domain/analytics'
import type { AssignmentMeta, PhaseInput, SentenceRow } from '@/lib/repo/assignments'

export type { AssignmentMeta }

// One phase as the teacher authored it, before its content is resolved. `useBankSet`
// means "this phase's sentences (and shadow video) come from the published bank set";
// otherwise the typed sentence list is used.
export interface PhaseDraft {
  id: number | null // existing phase id (edit) — null for a newly added phase
  title: string | null
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
  graded: boolean
  maxAttempts: number
}

function hasSubmitKind(p: PhaseDraft): boolean {
  return p.requireText || p.requireAudio || p.requireVideo || p.requireHandwriting
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
      instructions: d.instructions,
      chunkSetId: fromBank ? chunkSetId : null,
      shadowVideoKey: fromBank ? bankVideoKey : null,
      openAt: d.openAt,
      dueAt: d.dueAt,
      requireEyesClosed: d.requireEyesClosed,
      requireText: d.requireText,
      requireAudio: d.requireAudio,
      requireVideo: d.requireVideo,
      requireHandwriting: d.requireHandwriting,
      graded: d.graded,
      maxAttempts: d.maxAttempts,
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
  meta: AssignmentMeta,
  phaseDrafts: PhaseDraft[],
  offeringIds: number[],
  chunkSetId: number | null,
  primaryOfferingId: number | null,
): Promise<CreateResult> {
  if (offeringIds.length === 0) return { ok: false, error: 'err.needPublishTarget' }
  const validIds = await offerings.findIdsForSchool(prisma, offeringIds, schoolId)
  if (validIds.length === 0) return { ok: false, error: 'err.offeringNotFound' }

  const resolved = await resolvePhases(prisma, schoolId, phaseDrafts, chunkSetId)
  if (!resolved.ok) return { ok: false, error: resolved.error }

  // One standalone create per offering (no $transaction: D1 can't resolve the new
  // assignment's auto-increment id for its nested phase/sentence inserts in a batch).
  for (const offeringId of validIds) {
    await assignments.createWithPhases(prisma, offeringId, meta, resolved.phases)
  }

  // Return to the offering the teacher started from, if it was among the targets.
  const target = primaryOfferingId && validIds.includes(primaryOfferingId) ? primaryOfferingId : validIds[0]
  return { ok: true, redirectTo: `/dashboard/teaching/${target}` }
}

export type UpdateResult = { ok: true } | { ok: false; error: string }

export async function updateAssignment(
  prisma: PrismaClient,
  schoolId: number,
  assignmentId: number,
  meta: AssignmentMeta,
  phaseDrafts: PhaseDraft[],
  chunkSetId: number | null,
): Promise<UpdateResult> {
  const existing = await assignments.findForSchool(prisma, assignmentId, schoolId)
  if (!existing) return { ok: false, error: 'err.assignNotFound' }

  const resolved = await resolvePhases(prisma, schoolId, phaseDrafts, chunkSetId)
  if (!resolved.ok) return { ok: false, error: resolved.error }

  await assignments.updateWithPhases(prisma, assignmentId, meta, resolved.phases)
  return { ok: true }
}

// 学情 → 行动：把一个授课里"最弱的句子"生成一份复习作业。Returns where to go next
// (the new assignment's edit page, or insights when there's nothing weak yet).
export async function buildReviewAssignment(prisma: PrismaClient, offeringId: number): Promise<{ redirectTo: string }> {
  const list = await assignments.listWithSentencesForOffering(prisma, offeringId)
  const textByKey = new Map<string, { text: string; translation: string | null }>()
  for (const a of list) for (const s of a.sentences) textByKey.set(`${a.id}:${s.order}`, { text: s.text, translation: s.translation })

  const rawSubs = await submissions.listForOfferingLatestFirst(prisma, offeringId)
  const seen = new Set<string>()
  const subs: AnalyticsSubmission[] = []
  for (const s of rawSubs) {
    const k = `${s.studentId}:${s.assignmentId}`
    if (seen.has(k)) continue
    seen.add(k)
    subs.push({ studentId: s.studentId, assignmentId: s.assignmentId, status: s.status, finalScore: s.finalScore, needsReview: s.needsReview, perSentence: parsePerSentence(s.aiResult) })
  }

  const picked: SentenceRow[] = []
  const used = new Set<string>()
  for (const w of weakSentences(subs, 12)) {
    const e = textByKey.get(`${w.assignmentId}:${w.order}`)
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
