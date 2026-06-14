import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { buildScoreWorkbook, type ScoreExportRow } from '@/lib/roster'

const STATUS: Record<string, string> = {
  DRAFT: '未提交',
  UPLOADED: '待评阅',
  PROCESSING: '评阅中',
  GRADED: '已评阅',
  FLAGGED: '需复核',
  FAILED: '失败',
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assignmentId = Number(id)
  const classId = Number(req.nextUrl.searchParams.get('classId'))

  const user = await getCurrentUser()
  if (!user || user.role === 'STUDENT' || !user.schoolId) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  if (!Number.isInteger(assignmentId) || !Number.isInteger(classId)) {
    return new NextResponse('Bad request', { status: 400 })
  }

  const assignment = await prisma.assignment.findFirst({ where: { id: assignmentId, schoolId: user.schoolId } })
  const cls = await prisma.classGroup.findFirst({ where: { id: classId, schoolId: user.schoolId } })
  if (!assignment || !cls) return new NextResponse('Not found', { status: 404 })

  const students = await prisma.user.findMany({
    where: { schoolId: user.schoolId, classId, role: 'STUDENT' },
    orderBy: { studentNo: 'asc' },
  })
  const submissions = await prisma.submission.findMany({
    where: { assignmentId, studentId: { in: students.map((s) => s.id) } },
    orderBy: { attempt: 'desc' },
  })
  const latest = new Map<number, (typeof submissions)[number]>()
  for (const s of submissions) if (!latest.has(s.studentId)) latest.set(s.studentId, s)

  const rows: ScoreExportRow[] = students.map((st) => {
    const sub = latest.get(st.id)
    return {
      studentNo: st.studentNo ?? '',
      name: st.name ?? '',
      className: cls.name,
      status: sub ? STATUS[sub.status] ?? sub.status : '未提交',
      aiScore: sub?.aiScore ?? null,
      finalScore: sub?.finalScore ?? null,
      feedback: sub?.feedback ?? '',
      gradedAt: sub?.gradedAt ? sub.gradedAt.toISOString().slice(0, 16).replace('T', ' ') : '',
    }
  })

  const buf = await buildScoreWorkbook(cls.name, rows)
  const filename = `${assignment.title}-${cls.name}.xlsx`
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
