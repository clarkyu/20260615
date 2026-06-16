import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { buildGradebookWorkbook, type GradebookRow } from '@/lib/roster'
import { studentProfiles, parsePerSentence, type AnalyticsSubmission } from '@/lib/domain/analytics'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId: oid } = await params
  const offeringId = Number(oid)
  const user = await getCurrentUser()
  if (!user || user.role === 'STUDENT' || !user.schoolId) return new NextResponse('Unauthorized', { status: 401 })
  if (!Number.isInteger(offeringId)) return new NextResponse('Bad request', { status: 400 })

  const prisma = await getDb()
  const offering = await prisma.courseOffering.findFirst({
    where: { id: offeringId, schoolId: user.schoolId },
    include: { course: { select: { name: true } }, class: { select: { name: true } } },
  })
  if (!offering) return new NextResponse('Not found', { status: 404 })

  const [students, assignments, rawSubs, rawPractice] = await Promise.all([
    prisma.user.findMany({ where: { schoolId: user.schoolId, classId: offering.classId, role: 'STUDENT' }, select: { id: true, name: true, studentNo: true }, orderBy: { studentNo: 'asc' } }),
    prisma.assignment.findMany({ where: { offeringId }, select: { id: true, title: true }, orderBy: { createdAt: 'asc' } }),
    prisma.submission.findMany({ where: { assignment: { offeringId } }, select: { studentId: true, assignmentId: true, status: true, finalScore: true, needsReview: true, aiResult: true }, orderBy: [{ studentId: 'asc' }, { assignmentId: 'asc' }, { attempt: 'desc' }] }),
    prisma.practiceAttempt.findMany({ where: { assignment: { offeringId }, aiScore: { not: null } }, select: { studentId: true, assignmentId: true, aiScore: true } }),
  ])

  const seen = new Set<string>()
  const submissions: AnalyticsSubmission[] = []
  for (const s of rawSubs) {
    const k = `${s.studentId}:${s.assignmentId}`
    if (seen.has(k)) continue
    seen.add(k)
    submissions.push({ studentId: s.studentId, assignmentId: s.assignmentId, status: s.status, finalScore: s.finalScore, needsReview: s.needsReview, perSentence: parsePerSentence(s.aiResult) })
  }
  const roster = students.map((s) => ({ id: s.id, name: s.name ?? '', studentNo: s.studentNo ?? '' }))
  const practice = rawPractice.map((p) => ({ studentId: p.studentId, assignmentId: p.assignmentId, aiScore: p.aiScore }))
  const profiles = studentProfiles(roster, assignments, submissions, practice)

  const rows: GradebookRow[] = [...profiles]
    .sort((a, b) => a.studentNo.localeCompare(b.studentNo))
    .map((p) => ({ studentNo: p.studentNo, name: p.name, daily: p.dailyScore, exam: p.avgScore, done: `${p.submitted}/${p.totalAssignments}` }))

  const buf = buildGradebookWorkbook(offering.class.name, rows)
  const filename = `成绩单-${offering.course.name}-${offering.class.name}.xlsx`
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
