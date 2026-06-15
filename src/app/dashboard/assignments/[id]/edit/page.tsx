import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { AssignmentForm, type AssignmentInitial } from '@/components/assignment-form'

export default async function EditAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assignmentId = Number(id)
  if (!Number.isInteger(assignmentId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  if (!user.schoolId) redirect('/dashboard')

  const a = await prisma.assignment.findFirst({
    where: { id: assignmentId, offering: { schoolId: user.schoolId } },
    include: { sentences: { orderBy: { order: 'asc' } } },
  })
  if (!a) notFound()

  const initial: AssignmentInitial = {
    id: a.id,
    title: a.title,
    monthLabel: a.monthLabel ?? '',
    instructions: a.instructions ?? '',
    sentences: a.sentences.map((s) => s.text).join('\n'),
    openAt: a.openAt ? a.openAt.toISOString().slice(0, 16) : '',
    dueAt: a.dueAt ? a.dueAt.toISOString().slice(0, 16) : '',
    maxAttempts: a.maxAttempts,
    requireEyesClosed: a.requireEyesClosed,
    requireText: a.requireText,
    requireAudio: a.requireAudio,
    requireVideo: a.requireVideo,
  }

  return (
    <div className="py-2">
      <AssignmentForm initial={initial} />
    </div>
  )
}
