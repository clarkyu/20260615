import { notFound, redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Recorder } from './recorder'

export default async function StudentAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assignmentId = Number(id)
  if (!Number.isInteger(assignmentId)) notFound()

  const user = await requireRole('STUDENT')
  const me = await prisma.user.findUnique({ where: { id: user.userId } })
  if (me?.mustChangePassword) redirect('/student/change-password')
  if (!me?.classId) notFound()

  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, classes: { some: { classId: me.classId } } },
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
    <Recorder
      assignmentId={assignment.id}
      title={assignment.title}
      sentences={assignment.sentences.map((s) => ({ order: s.order, text: s.text }))}
      requireEyesClosed={assignment.requireEyesClosed}
      attemptsLeft={Math.max(0, assignment.maxAttempts - usedAttempts)}
      latestStatus={latest?.status ?? null}
      latestScore={latest?.finalScore ?? null}
      latestFeedback={latest?.feedback ?? null}
      windowState={notOpen ? 'not-open' : closed ? 'closed' : 'open'}
    />
  )
}
