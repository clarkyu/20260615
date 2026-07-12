import type { Prisma } from '@prisma/client'
import { parseChoices } from '@/lib/choices'
import { parseFillBlank } from '@/lib/fill-blank'
import { gradingStage } from '@/lib/domain/grading-progress'
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
    submissions: { include: { shadowTakes: { select: { order: true; aiScore: true; spokenText: true } }; gradingJob: { select: { status: true } } } }
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

// FAILED 也算「已提交」:那是自动评阅没跑完(已扣一次提交机会、行在老师队列里),绝不能
// 给学生渲染成「未提交」逼人白白重录——进度组件会把它显示成「本次由老师评阅」。
const DONE_STATUSES = ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED', 'FAILED']

// Renders the submit screen for ONE phase — either per-sentence shadowing (a bank
// phase with a video) or the eyes-closed/recitation flow. The single-phase landing
// page and the multi-phase per-phase route both render this; `heading` is the
// assignment title (single phase) or the phase's own label (multi-phase).
export function PhaseSubmit({ phase, heading, nextHref = null, nextLabel = null }: { phase: PhaseDetail; heading: string; nextHref?: string | null; nextLabel?: string | null }) {
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
  // A phase is per-sentence SHADOWING (看视频逐句录音) only when it draws from a bank
  // video AND isn't an eyes-closed phase. A bank-sourced phase that requires eyes
  // closed (闭眼背诵) must use the recitation flow instead — otherwise every phase
  // built from the same set would render identically as shadowing.
  const shadowChunks = !phase.requireEyesClosed && phase.shadowVideoKey && phase.chunkSet
    ? phase.chunkSet.chunks.map((c) => ({
        english: c.english,
        chinese: c.chinese,
        meaningEn: c.meaningEn,
        meaningZh: c.meaningZh,
        exampleEn: c.exampleEn,
        exampleZh: c.exampleZh,
      }))
    : null

  // 学生可见的评阅进度(排队中/评阅中/老师评):提交状态 × 评阅任务状态,单一口径折算。
  const stage = gradingStage(latest?.status, latest?.gradingJob?.status)

  if (shadowChunks) {
    const done = latest ? DONE_STATUSES.includes(latest.status) : false
    const initialRecorded = latest?.status === 'DRAFT' ? latest.shadowTakes.map((tk) => tk.order) : []
    return (
      <ShadowSubmit
        phaseId={phase.id}
        title={heading}
        category={phase.category}
        instructions={phase.instructions}
        chunks={shadowChunks}
        attemptsLeft={attemptsLeft}
        windowState={windowState}
        completed={done}
        latestScore={latest?.finalScore ?? null}
        latestFeedback={latest?.feedback ?? null}
        latestTakes={done ? (latest?.shadowTakes ?? []).map((tk) => ({ order: tk.order, aiScore: tk.aiScore, spokenText: tk.spokenText })) : []}
        initialRecorded={initialRecorded}
        submissionId={latest?.id ?? null}
        gradingStage={stage}
        nextHref={nextHref}
        nextLabel={nextLabel}
        isFormalTest={phase.isFormalTest}
      />
    )
  }

  const graded = parseGraded(latest?.aiResult)
  return (
    <SubmissionFlow
      phaseId={phase.id}
      title={heading}
      category={phase.category}
      instructions={phase.instructions}
      shadowing={null}
      practice={windowOpen && sentences.length > 0 ? <PracticePanel phaseId={phase.id} sentences={sentences} /> : null}
      sentences={sentences}
      requireEyesClosed={phase.requireEyesClosed}
      requireText={phase.requireText}
      requireVideo={phase.requireVideo}
      requireAudio={phase.requireAudio}
      requireHandwriting={phase.requireHandwriting}
      requireChoice={phase.requireChoice}
      choices={parseChoices(phase.choicesJson)}
      correctChoice={phase.correctChoice}
      multiChoice={phase.multiChoice}
      correctChoices={parseChoices(phase.correctChoices)}
      fillBlank={phase.fillBlank}
      fillText={parseFillBlank(phase.blanksJson).text}
      requireFreeText={phase.requireFreeText}
      attemptsLeft={attemptsLeft}
      windowState={windowState}
      initialHasText={Boolean(latest?.recitedText)}
      initialRecitedText={latest?.recitedText ?? ''}
      latestStatus={latest?.status ?? null}
      gradingStage={stage}
      latestScore={latest?.finalScore ?? null}
      latestFeedback={latest?.feedback ?? null}
      latestPerSentence={graded.perSentence}
      latestTranscript={graded.transcript}
      submissionId={latest?.id ?? null}
      hasVideo={Boolean(latest?.videoKey)}
      hasAudio={Boolean(latest?.audioKey)}
      hasImage={Boolean(latest?.imageKey)}
      nextHref={nextHref}
      nextLabel={nextLabel}
      isFormalTest={phase.isFormalTest}
    />
  )
}
