import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
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

  const latestByStudent = new Map<number, (typeof assignment.submissions)[number]>()
  for (const s of assignment.submissions) {
    if (!latestByStudent.has(s.studentId)) latestByStudent.set(s.studentId, s)
  }

  const rows = [...latestByStudent.values()].map((s) => ({
    id: s.id,
    studentName: s.student.name ?? '',
    studentNo: s.student.studentNo ?? '',
    className: assignment.offering.class.name,
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

  const sem = assignment.offering.semester === '2' ? t('teach.sem2') : t('teach.sem1')

  return (
    <div>
      <Link href={`/dashboard/teaching/${assignment.offeringId}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />
        {assignment.offering.course.name} · {assignment.offering.class.name} · {assignment.offering.year} {sem}
      </Link>
      <GradingClient
        assignmentId={assignment.id}
        title={assignment.title}
        category={assignment.category}
        sentenceCount={assignment._count.sentences}
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
