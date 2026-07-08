import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import * as assignmentRepo from '@/lib/repo/assignments'
import { AssignmentForm, type AssignmentInitial } from '@/components/assignment-form'
import { parseChoices } from '@/lib/choices'
import { parseFillBlank } from '@/lib/fill-blank'

export default async function EditAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assignmentId = Number(id)
  if (!Number.isInteger(assignmentId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  if (!user.schoolId) redirect('/dashboard')

  const a = await assignmentRepo.findForStaffWithPhases(prisma, assignmentId, user.schoolId, user.userId, user.role)
  if (!a) notFound()

  // Per-phase (non-DRAFT) submission counts — so the form can warn before removing a
  // phase that already has student submissions (removing it cascade-deletes those).
  const submissionCounts = await assignmentRepo.submittedCountByPhase(prisma, assignmentId)

  // The set this assignment draws from (any phase that uses one — all share it).
  const bank = a.phases.find((p) => p.chunkSet)?.chunkSet ?? null

  const initial: AssignmentInitial = {
    id: a.id,
    version: a.version,
    title: a.title,
    mode: a.mode ?? '',
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
      correctIndex: p.correctChoice ? parseChoices(p.choicesJson).indexOf(p.correctChoice) : -1,
      multiChoice: p.multiChoice,
      correctIndices: parseChoices(p.correctChoices).map((c) => parseChoices(p.choicesJson).indexOf(c)).filter((i) => i >= 0),
      selectionMode: p.selectionMode === 'poll' || p.selectionMode === 'theme' || p.selectionMode === 'branch' ? p.selectionMode : null,
      branchTopics: parseChoices(p.branchTopicsJson),
      fillBlank: p.fillBlank,
      fillText: parseFillBlank(p.blanksJson).text,
      fillAccept: parseFillBlank(p.blanksJson).accept.map((a) => a.join(' | ')),
      requireFreeText: p.requireFreeText,
      rubric: p.rubric ?? '',
      perceptionModel: p.defaultPerceptionModel ?? '',
      judgeModel: p.defaultJudgeModel ?? '',
      graded: p.graded,
      maxAttempts: p.maxAttempts,
      weight: p.weight,
      isFormalTest: p.isFormalTest,
      freePractice: p.freePractice,
      submissionCount: submissionCounts.get(p.id) ?? 0,
    })),
  }

  return (
    <div className="py-2">
      <AssignmentForm initial={initial} />
    </div>
  )
}
