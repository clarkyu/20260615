import { notFound, redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { parsePerSentence } from '@/lib/domain/analytics'
import { SubmissionFlow } from './submission-flow'
import { PracticePanel } from './practice-panel'
import { ShadowSubmit } from './shadow-submit'

export default async function StudentAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assignmentId = Number(id)
  if (!Number.isInteger(assignmentId)) notFound()

  const user = await requireRole('STUDENT')
  const prisma = await getDb()
  const me = await prisma.user.findUnique({ where: { id: user.userId } })
  if (me?.mustChangePassword) redirect('/student/change-password')
  if (!me?.classId) notFound()

  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, offering: { classId: me.classId } },
    include: {
      sentences: { orderBy: { order: 'asc' } },
      chunkSet: { include: { chunks: { orderBy: { order: 'asc' } } } },
      submissions: { where: { studentId: user.userId }, orderBy: { attempt: 'desc' }, take: 1, include: { shadowTakes: { select: { order: true } } } },
    },
  })
  if (!assignment) notFound()

  const latest = assignment.submissions[0]
  const usedAttempts = await prisma.submission.count({
    where: {
      assignmentId,
      studentId: user.userId,
      status: { in: ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED'] },
    },
  })

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
      latestPerSentence={parsePerSentence(latest?.aiResult)}
    />
  )
}
