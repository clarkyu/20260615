import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import * as assignmentRepo from '@/lib/repo/assignments'
import { AssignmentForm, type AssignmentInitial } from '@/components/assignment-form'
import { parseChoices } from '@/lib/choices'

export default async function EditAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assignmentId = Number(id)
  if (!Number.isInteger(assignmentId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  if (!user.schoolId) redirect('/dashboard')

  const a = await assignmentRepo.findForStaffWithPhases(prisma, assignmentId, user.schoolId, user.userId, user.role)
  if (!a) notFound()

  // The set this assignment draws from (any phase that uses one — all share it).
  const bank = a.phases.find((p) => p.chunkSet)?.chunkSet ?? null

  const initial: AssignmentInitial = {
    id: a.id,
    title: a.title,
    monthLabel: a.monthLabel ?? '',
    chunkSetId: bank?.id ?? null,
    chunkSetName: bank?.name ?? null,
    chunkSetCount: bank?._count.chunks ?? 0,
    chunkSetHasVideo: Boolean(bank?.shadowVideoKey),
    phases: a.phases.map((p) => ({
      id: p.id,
      title: p.title ?? '',
      category: p.category ?? '',
      instructions: p.instructions ?? '',
      useBankSet: p.chunkSetId != null,
      sentences: p.sentences.map((s) => s.text).join('\n'),
      // Full UTC ISO; the form converts to the teacher's local time for the input.
      openAt: p.openAt ? p.openAt.toISOString() : '',
      dueAt: p.dueAt ? p.dueAt.toISOString() : '',
      requireEyesClosed: p.requireEyesClosed,
      requireText: p.requireText,
      requireAudio: p.requireAudio,
      requireVideo: p.requireVideo,
      requireHandwriting: p.requireHandwriting,
      requireChoice: p.requireChoice,
      choices: parseChoices(p.choicesJson),
      requireFreeText: p.requireFreeText,
      graded: p.graded,
      maxAttempts: p.maxAttempts,
      isFormalTest: p.isFormalTest,
      freePractice: p.freePractice,
    })),
  }

  return (
    <div className="py-2">
      <AssignmentForm initial={initial} />
    </div>
  )
}
