import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as userRepo from '@/lib/repo/users'
import * as assignmentRepo from '@/lib/repo/assignments'
import { PhaseSubmit } from '../../phase-submit'

// One phase's submit screen (reached from the multi-phase checklist).
export default async function StudentPhasePage({ params }: { params: Promise<{ id: string; phaseId: string }> }) {
  const { id, phaseId } = await params
  const assignmentId = Number(id)
  const pid = Number(phaseId)
  if (!Number.isInteger(assignmentId) || !Number.isInteger(pid)) notFound()

  const user = await requireRole('STUDENT')
  const prisma = await getDb()
  const me = await userRepo.findById(prisma, user.userId)
  if (me?.mustChangePassword) redirect('/student/change-password')
  const classIds = await userRepo.studentClassIds(prisma, user.userId)
  if (classIds.length === 0) notFound()

  const phase = await assignmentRepo.findPhaseDetailForStudent(prisma, pid, classIds, user.userId)
  if (!phase || phase.assignmentId !== assignmentId) notFound()

  const { t } = await getT()
  const heading = phase.title?.trim() || t('phase.nth', { n: phase.order })
  return (
    <div className="space-y-3">
      <Link href={`/student/assignments/${assignmentId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{t('phase.backToList')}
      </Link>
      <PhaseSubmit phase={phase} heading={heading} />
    </div>
  )
}
