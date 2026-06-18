import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft, Eye } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { PRESETS, modelsForCapability } from '@/lib/ai/registry'
import { countViolations } from '@/lib/domain/grading'
import * as assignmentRepo from '@/lib/repo/assignments'
import { GradingClient } from './grading-client'

export default async function AssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assignmentId = Number(id)
  if (!Number.isInteger(assignmentId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const assignment = await assignmentRepo.findDetailForStaff(prisma, assignmentId, user.schoolId)
  if (!assignment) notFound()

  // A submission is per-phase: keep the latest attempt per (student, phase). When the
  // assignment has several phases, label each row with its phase.
  const multiPhase = assignment.phases.length > 1
  const latestByStudentPhase = new Map<string, (typeof assignment.submissions)[number]>()
  for (const s of assignment.submissions) {
    const key = `${s.studentId}:${s.phaseId ?? 0}`
    if (!latestByStudentPhase.has(key)) latestByStudentPhase.set(key, s)
  }

  const rows = [...latestByStudentPhase.values()]
    .map((s) => ({
      id: s.id,
      studentName: s.student.name ?? '',
      studentNo: s.student.studentNo ?? '',
      className: assignment.offering.class.name,
      phaseOrder: s.phase?.order ?? 0,
      phaseLabel: multiPhase ? (s.phase?.title?.trim() || t('phase.nth', { n: s.phase?.order ?? 0 })) : undefined,
      status: s.status,
      needsReview: s.needsReview,
      aiScore: s.aiScore,
      finalScore: s.finalScore,
      feedback: s.feedback ?? '',
      hasVideo: Boolean(s.videoKey),
      hasAudio: Boolean(s.audioKey),
      hasImage: Boolean(s.imageKey),
      recitedText: s.recitedText ?? '',
      violations: countViolations(s.violations),
    }))
    .sort((a, b) => a.studentNo.localeCompare(b.studentNo) || a.phaseOrder - b.phaseOrder)

  const sem = assignment.offering.semester === '2' ? t('teach.sem2') : t('teach.sem1')

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href={`/dashboard/teaching/${assignment.offeringId}`} className="inline-flex min-w-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4 shrink-0" />
          <span className="truncate">{assignment.offering.course.name} · {assignment.offering.class.name} · {assignment.offering.year} {sem}</span>
        </Link>
        <Link href={`/dashboard/assignments/${assignment.id}/preview`} className="tap inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          <Eye className="h-3.5 w-3.5" />{t('preview.view')}
        </Link>
      </div>
      <GradingClient
        assignmentId={assignment.id}
        title={assignment.title}
        category={assignment.category}
        sentenceCount={assignment._count.sentences}
        studentCount={new Set([...latestByStudentPhase.values()].map((s) => s.studentId)).size}
        classes={[{ id: assignment.offering.class.id, name: assignment.offering.class.name }]}
        rows={rows}
        presets={PRESETS}
        perceptionModels={modelsForCapability('perception').map((m) => ({ id: m.id, label: m.label }))}
        judgeModels={modelsForCapability('judge').map((m) => ({ id: m.id, label: m.label }))}
        defaultRubric={assignment.rubric ?? ''}
      />
    </div>
  )
}
