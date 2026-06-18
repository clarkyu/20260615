import type { Prisma } from '@prisma/client'
import { SubmissionFlow } from './submission-flow'
import { PracticePanel } from './practice-panel'
import { ShadowSubmit } from './shadow-submit'

// The phase a student submits to, with its content + their submissions — exactly what
// `findPhaseDetailForStudent` returns.
type PhaseDetail = Prisma.PhaseGetPayload<{
  include: {
    sentences: { orderBy: { order: 'asc' } }
    chunkSet: { include: { chunks: { orderBy: { order: 'asc' } } } }
    assignment: { select: { id: true; title: true; category: true } }
    submissions: { include: { shadowTakes: { select: { order: true } } } }
  }
}>

// Parse the stored AI result for the learner-facing detail: transcript + per-sentence
// (accuracy/completeness + what they actually said).
function parseGraded(aiResult: string | null | undefined): {
  transcript: string
  perSentence: { order: number; accuracy: number; completeness: number; spokenText: string }[]
} {
  try {
    const p = JSON.parse(aiResult ?? '') as { perception?: { transcript?: string; perSentence?: { order: number; spokenText?: string; accuracy: number; completeness: number }[] } }
    const ps = p?.perception?.perSentence
    return {
      transcript: typeof p?.perception?.transcript === 'string' ? p.perception.transcript : '',
      perSentence: Array.isArray(ps)
        ? ps.map((s) => ({ order: s.order, accuracy: Number(s.accuracy) || 0, completeness: Number(s.completeness) || 0, spokenText: typeof s.spokenText === 'string' ? s.spokenText : '' }))
        : [],
    }
  } catch {
    return { transcript: '', perSentence: [] }
  }
}

const DONE_STATUSES = ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED']

// Renders the submit screen for ONE phase — either per-sentence shadowing (a bank
// phase with a video) or the eyes-closed/recitation flow. The single-phase landing
// page and the multi-phase per-phase route both render this; `heading` is the
// assignment title (single phase) or the phase's own label (multi-phase).
export function PhaseSubmit({ phase, heading }: { phase: PhaseDetail; heading: string }) {
  const latest = phase.submissions[0]
  // Anything past DRAFT consumed an attempt (matches repo ACTIVE_STATUSES).
  const usedAttempts = phase.submissions.filter((s) => s.status !== 'DRAFT').length
  const attemptsLeft = Math.max(0, phase.maxAttempts - usedAttempts)

  const now = new Date()
  const notOpen = phase.openAt ? now < phase.openAt : false
  const closed = phase.dueAt ? now > phase.dueAt : false
  const windowState = notOpen ? 'not-open' : closed ? 'closed' : 'open'
  const windowOpen = windowState === 'open'

  const sentences = phase.sentences.map((s) => ({ order: s.order, text: s.text }))
  const shadowChunks = phase.shadowVideoKey && phase.chunkSet
    ? phase.chunkSet.chunks.map((c) => ({
        english: c.english,
        chinese: c.chinese,
        meaningEn: c.meaningEn,
        meaningZh: c.meaningZh,
        exampleEn: c.exampleEn,
        exampleZh: c.exampleZh,
      }))
    : null

  if (shadowChunks) {
    const done = latest ? DONE_STATUSES.includes(latest.status) : false
    const initialRecorded = latest?.status === 'DRAFT' ? latest.shadowTakes.map((tk) => tk.order) : []
    return (
      <ShadowSubmit
        phaseId={phase.id}
        title={heading}
        category={phase.assignment.category}
        instructions={phase.instructions}
        chunks={shadowChunks}
        attemptsLeft={attemptsLeft}
        windowState={windowState}
        completed={done}
        latestScore={latest?.finalScore ?? null}
        latestFeedback={latest?.feedback ?? null}
        initialRecorded={initialRecorded}
      />
    )
  }

  const graded = parseGraded(latest?.aiResult)
  return (
    <SubmissionFlow
      phaseId={phase.id}
      title={heading}
      category={phase.assignment.category}
      instructions={phase.instructions}
      shadowing={null}
      practice={windowOpen && sentences.length > 0 ? <PracticePanel phaseId={phase.id} sentences={sentences} /> : null}
      sentences={sentences}
      requireEyesClosed={phase.requireEyesClosed}
      requireText={phase.requireText}
      requireVideo={phase.requireVideo}
      requireAudio={phase.requireAudio}
      requireHandwriting={phase.requireHandwriting}
      attemptsLeft={attemptsLeft}
      windowState={windowState}
      initialHasText={Boolean(latest?.recitedText)}
      initialRecitedText={latest?.recitedText ?? ''}
      latestStatus={latest?.status ?? null}
      latestScore={latest?.finalScore ?? null}
      latestFeedback={latest?.feedback ?? null}
      latestPerSentence={graded.perSentence}
      latestTranscript={graded.transcript}
    />
  )
}
