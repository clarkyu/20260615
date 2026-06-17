import { notFound, redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { getDb } from '@/lib/db'
import * as userRepo from '@/lib/repo/users'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as submissionRepo from '@/lib/repo/submissions'
import { SubmissionFlow } from './submission-flow'
import { PracticePanel } from './practice-panel'
import { ShadowSubmit } from './shadow-submit'

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

export default async function StudentAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assignmentId = Number(id)
  if (!Number.isInteger(assignmentId)) notFound()

  const user = await requireRole('STUDENT')
  const prisma = await getDb()
  const me = await userRepo.findById(prisma, user.userId)
  if (me?.mustChangePassword) redirect('/student/change-password')
  const classIds = await userRepo.studentClassIds(prisma, user.userId)
  if (classIds.length === 0) notFound()

  const assignment = await assignmentRepo.findForStudentDetail(prisma, assignmentId, classIds, user.userId)
  if (!assignment) notFound()

  const latest = assignment.submissions[0]
  const usedAttempts = await submissionRepo.countActiveAttempts(prisma, assignmentId, user.userId)

  const now = new Date()
  const notOpen = assignment.openAt ? now < assignment.openAt : false
  const closed = assignment.dueAt ? now > assignment.dueAt : false
  const sentences = assignment.sentences.map((s) => ({ order: s.order, text: s.text }))
  const windowOpen = !notOpen && !closed
  const shadowChunks = assignment.shadowVideoKey && assignment.chunkSet
    ? assignment.chunkSet.chunks.map((c) => ({
        english: c.english,
        chinese: c.chinese,
        meaningEn: c.meaningEn,
        meaningZh: c.meaningZh,
        exampleEn: c.exampleEn,
        exampleZh: c.exampleZh,
      }))
    : null

  // Shadowing assignment → per-sentence (逐句) shadowing flow.
  if (shadowChunks) {
    const done = latest ? ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED'].includes(latest.status) : false
    const initialRecorded = latest?.status === 'DRAFT' ? latest.shadowTakes.map((tk) => tk.order) : []
    return (
      <ShadowSubmit
        assignmentId={assignment.id}
        title={assignment.title}
        category={assignment.category}
        instructions={assignment.instructions}
        chunks={shadowChunks}
        attemptsLeft={Math.max(0, assignment.maxAttempts - usedAttempts)}
        windowState={notOpen ? 'not-open' : closed ? 'closed' : 'open'}
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
      assignmentId={assignment.id}
      title={assignment.title}
      category={assignment.category}
      instructions={assignment.instructions}
      shadowing={null}
      practice={windowOpen && sentences.length > 0 ? <PracticePanel assignmentId={assignment.id} sentences={sentences} /> : null}
      sentences={sentences}
      requireEyesClosed={assignment.requireEyesClosed}
      requireText={assignment.requireText}
      requireVideo={assignment.requireVideo}
      requireAudio={assignment.requireAudio}
      requireHandwriting={assignment.requireHandwriting}
      attemptsLeft={Math.max(0, assignment.maxAttempts - usedAttempts)}
      windowState={notOpen ? 'not-open' : closed ? 'closed' : 'open'}
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
