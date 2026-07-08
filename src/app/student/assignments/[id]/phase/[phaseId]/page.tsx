import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as userRepo from '@/lib/repo/users'
import * as assignmentRepo from '@/lib/repo/assignments'
import { representativeSubmission } from '@/lib/domain/submit'
import { isPhaseActiveFor } from '@/lib/domain/selection'
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

  const [phase, overview] = await Promise.all([
    assignmentRepo.findPhaseDetailForStudent(prisma, pid, classIds, user.userId),
    assignmentRepo.findForStudentPhaseList(prisma, assignmentId, classIds, user.userId),
  ])
  if (!phase || phase.assignmentId !== assignmentId) notFound()

  // 甲·分流：读学生在「选题·分流」环节选的题目。若本环节是「非你所选主题」的带门环节、且还没交过 →
  // 不属于这个学生,回作业首页(那里显示为「待选题解锁 / 非你主题」)。已有历史提交则放行(软性只读:可看)。
  const selectionPhase = overview?.phases.find((p) => p.selectionMode === 'branch')
  const chosenTopic = selectionPhase ? (representativeSubmission(selectionPhase.submissions)?.recitedText?.trim() || null) : null
  if (!isPhaseActiveFor(phase.branchTopicsJson, chosenTopic) && !phase.submissions.some((s) => s.status !== 'DRAFT')) {
    redirect(`/student/assignments/${assignmentId}`)
  }

  const { t } = await getT()
  const heading = phase.title?.trim() || t('phase.nth', { n: phase.order })

  // 多环节自动衔接：交完本环节后，引导/自动进入「之后第一个还没做、且在开放期内、且属于我所选主题」的环节。
  const DONE = ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED']
  const now = new Date()
  let nextHref: string | null = null
  let nextLabel: string | null = null
  if (overview) {
    const curIdx = overview.phases.findIndex((p) => p.id === pid)
    for (let i = curIdx + 1; i < overview.phases.length; i++) {
      const p = overview.phases[i]
      const rep = representativeSubmission(p.submissions)
      const done = rep ? DONE.includes(rep.status) : false
      const notOpen = p.openAt ? now < p.openAt : false
      const closed = p.dueAt ? now > p.dueAt : false
      if (!done && !notOpen && !closed && isPhaseActiveFor(p.branchTopicsJson, chosenTopic)) {
        nextHref = `/student/assignments/${assignmentId}/phase/${p.id}`
        nextLabel = p.title?.trim() || t('phase.nth', { n: i + 1 })
        break
      }
    }
  }

  return (
    <div className="space-y-3">
      <Link href={`/student/assignments/${assignmentId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{t('phase.backToList')}
      </Link>
      <PhaseSubmit phase={phase} heading={heading} nextHref={nextHref} nextLabel={nextLabel} />
    </div>
  )
}
