import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import * as assignmentRepo from '@/lib/repo/assignments'
import { AssignmentForm, type AssignmentInitial } from '@/components/assignment-form'

export default async function EditAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assignmentId = Number(id)
  if (!Number.isInteger(assignmentId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  if (!user.schoolId) redirect('/dashboard')

  const a = await assignmentRepo.findForStaffWithSentences(prisma, assignmentId, user.schoolId)
  if (!a) notFound()

  const initial: AssignmentInitial = {
    id: a.id,
    title: a.title,
    category: a.category ?? '',
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
    requireHandwriting: a.requireHandwriting,
  }

  return (
    <div className="py-2">
      <AssignmentForm initial={initial} />
    </div>
  )
}
