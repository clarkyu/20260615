import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { AssignmentForm, type AssignmentInitial } from '../../assignment-form'

export default async function EditAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assignmentId = Number(id)
  if (!Number.isInteger(assignmentId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  if (!user.schoolId) redirect('/dashboard')

  const a = await prisma.assignment.findFirst({
    where: { id: assignmentId, schoolId: user.schoolId },
    include: { sentences: { orderBy: { order: 'asc' } }, classes: { select: { classId: true } } },
  })
  if (!a) notFound()

  const classes = await prisma.classGroup.findMany({
    where: { schoolId: user.schoolId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  const initial: AssignmentInitial = {
    id: a.id,
    title: a.title,
    monthLabel: a.monthLabel ?? '',
    sentences: a.sentences.map((s) => s.text).join('\n'),
    classIds: a.classes.map((c) => c.classId),
    openAt: a.openAt ? a.openAt.toISOString().slice(0, 16) : '',
    dueAt: a.dueAt ? a.dueAt.toISOString().slice(0, 16) : '',
    maxAttempts: a.maxAttempts,
    requireEyesClosed: a.requireEyesClosed,
  }

  return (
    <div className="py-2">
      <AssignmentForm classes={classes} initial={initial} />
    </div>
  )
}
