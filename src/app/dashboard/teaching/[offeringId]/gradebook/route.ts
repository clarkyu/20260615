import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import * as offeringRepo from '@/lib/repo/offerings'
import * as userRepo from '@/lib/repo/users'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as submissionRepo from '@/lib/repo/submissions'
import * as practiceRepo from '@/lib/repo/practice'
import { buildGradebookWorkbook, type GradebookRow } from '@/lib/roster'
import { studentProfiles, latestPhaseSubmissions, collapsePhases } from '@/lib/domain/analytics'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId: oid } = await params
  const offeringId = Number(oid)
  const user = await getCurrentUser()
  if (!user || user.role === 'STUDENT' || !user.schoolId) return new NextResponse('Unauthorized', { status: 401 })
  if (!Number.isInteger(offeringId)) return new NextResponse('Bad request', { status: 400 })

  const prisma = await getDb()
  const offering = await offeringRepo.findForSchoolWithCourseClass(prisma, offeringId, user.schoolId)
  if (!offering) return new NextResponse('Not found', { status: 404 })

  const [students, assignments, rawSubs, rawPractice] = await Promise.all([
    userRepo.listClassRoster(prisma, user.schoolId, offering.classId),
    assignmentRepo.listForOfferingBrief(prisma, offeringId),
    submissionRepo.listForOfferingGradebook(prisma, offeringId),
    practiceRepo.listScoredForOffering(prisma, offeringId),
  ])

  const submissions = collapsePhases(latestPhaseSubmissions(rawSubs))
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
