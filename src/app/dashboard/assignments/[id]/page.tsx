import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { PRESETS, modelsForCapability } from '@/lib/ai/registry'
import { GradingClient } from './grading-client'

export default async function AssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assignmentId = Number(id)
  if (!Number.isInteger(assignmentId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  const me = await prisma.user.findUnique({ where: { id: user.userId } })
  if (!me?.schoolId) redirect('/dashboard')

  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, schoolId: me.schoolId },
    include: {
      _count: { select: { sentences: true } },
      classes: { include: { class: { select: { id: true, name: true } } } },
      submissions: {
        include: { student: { select: { name: true, studentNo: true, class: { select: { name: true } } } } },
        orderBy: [{ studentId: 'asc' }, { attempt: 'desc' }],
      },
    },
  })
  if (!assignment) notFound()

  // Keep only the latest attempt per student.
  const latestByStudent = new Map<number, (typeof assignment.submissions)[number]>()
  for (const s of assignment.submissions) {
    if (!latestByStudent.has(s.studentId)) latestByStudent.set(s.studentId, s)
  }

  const rows = [...latestByStudent.values()].map((s) => ({
    id: s.id,
    studentName: s.student.name ?? '',
    studentNo: s.student.studentNo ?? '',
    className: s.student.class?.name ?? '',
    status: s.status,
    aiScore: s.aiScore,
    finalScore: s.finalScore,
    feedback: s.feedback ?? '',
    hasVideo: Boolean(s.videoKey),
    recitedText: s.recitedText ?? '',
    violations: s.violations ? (JSON.parse(s.violations) as unknown[]).length : 0,
  }))

  return (
    <GradingClient
      assignmentId={assignment.id}
      title={assignment.title}
      sentenceCount={assignment._count.sentences}
      classes={assignment.classes.map((c) => ({ id: c.class.id, name: c.class.name }))}
      rows={rows}
      presets={PRESETS}
      perceptionModels={modelsForCapability('perception').map((m) => ({ id: m.id, label: m.label }))}
      judgeModels={modelsForCapability('judge').map((m) => ({ id: m.id, label: m.label }))}
      defaultRubric={assignment.rubric ?? ''}
    />
  )
}
