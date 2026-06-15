import { notFound, redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { SubmissionFlow } from './submission-flow'

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
      submissions: { where: { studentId: user.userId }, orderBy: { attempt: 'desc' }, take: 1 },
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

  return (
    <SubmissionFlow
      assignmentId={assignment.id}
      title={assignment.title}
      instructions={assignment.instructions}
      sentences={assignment.sentences.map((s) => ({ order: s.order, text: s.text }))}
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
    />
  )
}
