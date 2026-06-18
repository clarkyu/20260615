import { notFound, redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { getDb } from '@/lib/db'
import * as userRepo from '@/lib/repo/users'
import * as assignmentRepo from '@/lib/repo/assignments'
import { PhaseSubmit } from './phase-submit'
import { PhaseList } from './phase-list'

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

  const overview = await assignmentRepo.findForStudentPhaseList(prisma, assignmentId, classIds, user.userId)
  if (!overview || overview.phases.length === 0) notFound()

  // Several phases → the checklist landing; one phase → straight into the flow (the
  // pre-phases single-submission experience, unchanged).
  if (overview.phases.length > 1) return <PhaseList assignment={overview} />

  const phase = await assignmentRepo.findPhaseDetailForStudent(prisma, overview.phases[0].id, classIds, user.userId)
  if (!phase) notFound()
  return <PhaseSubmit phase={phase} heading={overview.title} />
}
