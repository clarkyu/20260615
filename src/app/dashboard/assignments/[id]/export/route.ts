import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as classRepo from '@/lib/repo/classes'
import * as userRepo from '@/lib/repo/users'
import * as submissionRepo from '@/lib/repo/submissions'
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

  const prisma = await getDb()
  const assignment = await assignmentRepo.findForSchool(prisma, assignmentId, user.schoolId, user.userId, user.role)
  const cls = await classRepo.findClassForSchool(prisma, classId, user.schoolId)
  if (!assignment || !cls) return new NextResponse('Not found', { status: 404 })

  const students = await userRepo.listClassRoster(prisma, user.schoolId, classId)
  const submissions = await submissionRepo.listForAssignmentStudents(prisma, assignmentId, students.map((s) => s.id))

  // Per-phase latest-first → keep the latest per (student, phase), grouped by student.
  const seenPhase = new Set<string>()
  const byStudent = new Map<number, (typeof submissions)[number][]>()
  for (const s of submissions) {
    const pk = `${s.studentId}:${s.phaseId ?? 0}`
    if (seenPhase.has(pk)) continue
    seenPhase.add(pk)
    const arr = byStudent.get(s.studentId)
    if (arr) arr.push(s)
    else byStudent.set(s.studentId, [s])
  }
  // Graded phases present across the class, ordered. When there's more than one, the
  // export adds a score column per phase so the single mean isn't the only number.
  const phaseMeta = new Map<number, { order: number; title: string }>()
  for (const s of submissions) {
    if (s.phaseId != null && (s.phase?.graded ?? true) && !phaseMeta.has(s.phaseId)) {
      phaseMeta.set(s.phaseId, { order: s.phase?.order ?? 0, title: s.phase?.title?.trim() || `环节${s.phase?.order ?? ''}` })
    }
  }
  const phaseList = [...phaseMeta.entries()].map(([pid, m]) => ({ id: pid, ...m })).sort((a, b) => a.order - b.order)
  const multiPhase = phaseList.length > 1

  const meanOf = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null)
  const fmt = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ')

  const rows: ScoreExportRow[] = students.map((st) => {
    const phases = (byStudent.get(st.id) ?? []).sort((a, b) => (a.phase?.order ?? 0) - (b.phase?.order ?? 0))
    if (phases.length === 0) {
      return { studentNo: st.studentNo ?? '', name: st.name ?? '', className: cls.name, status: STATUS.DRAFT, aiScore: null, finalScore: null, feedback: '', gradedAt: '' }
    }
    // Score = mean over the GRADED phases — a multi-phase assignment's single score.
    const graded = phases.filter((p) => p.phase?.graded ?? true)
    const finalScore = meanOf(graded.map((p) => p.finalScore).filter((v): v is number => v != null))
    const aiScore = meanOf(graded.map((p) => p.aiScore).filter((v): v is number => v != null))
    const status = graded.length > 0 && graded.every((p) => p.status === 'GRADED') ? STATUS.GRADED : phases.some((p) => p.status === 'FLAGGED') ? STATUS.FLAGGED : STATUS.UPLOADED
    const multi = phases.length > 1
    const feedback = phases
      .filter((p) => p.feedback)
      .map((p) => (multi ? `【${p.phase?.title?.trim() || `环节${p.phase?.order ?? ''}`}】${p.feedback}` : p.feedback))
      .join('\n')
    const lastGraded = phases.map((p) => p.gradedAt).filter((v): v is Date => v != null).sort((a, b) => b.getTime() - a.getTime())[0]
    const phaseScores = multiPhase
      ? phaseList.map((gp) => phases.find((p) => p.phaseId === gp.id)?.finalScore ?? null)
      : undefined
    return { studentNo: st.studentNo ?? '', name: st.name ?? '', className: cls.name, status, aiScore, finalScore, phaseScores, feedback, gradedAt: lastGraded ? fmt(lastGraded) : '' }
  })

  const buf = await buildScoreWorkbook(cls.name, rows, multiPhase ? phaseList.map((p) => p.title) : [])
  const filename = `${assignment.title}-${cls.name}.xlsx`
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
