import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { assignments, attempts, papers } from '@/lib/db/schema'
import { ensureUser } from '@/lib/db/queries'
import { startAssignmentAttempt } from '@/lib/db/assignments'
import { getSession } from '@/lib/auth/session'
import { isUuid } from '@/lib/uuid'

// POST /api/attempts:开始作答(SPEC §9.4)。
//   { assignmentId }        任务作答(M5):校验班级成员与开放期;mode 取任务;考试 deadline =
//                           min(now + 时长, 截止);任务考试默认不可重做(settings.allowRetake 放开),
//                           未交的续答同一 attempt;子集组卷照常建 attempt(paperId 为任务的试卷)。
//   { paperId, mode }       自由练习 / 自由模考(M2–M3,D9):未交的模考续答,已交不挡新开。
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })

  let body: { paperId?: unknown; mode?: unknown; assignmentId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: '请求体不是 JSON' } }, { status: 400 })
  }
  const db = getDb()
  const userId = await ensureUser(db, session.user)

  if (typeof body.assignmentId === 'string' && body.assignmentId) {
    if (!isUuid(body.assignmentId)) return NextResponse.json({ error: { code: 'not_found', message: '任务不存在' } }, { status: 404 })
    const a = await db.query.assignments.findFirst({ where: eq(assignments.id, body.assignmentId) })
    if (!a || !a.paperId) return NextResponse.json({ error: { code: 'not_found', message: '任务不存在' } }, { status: 404 })
    // 判定 + 建 attempt 在同一事务、按(任务, 学生)加锁:双击 / 双设备不会建出两份作答。
    const rule = await startAssignmentAttempt(db, a, userId)
    if (rule.kind === 'denied') {
      const status = rule.code === 'not_member' ? 403 : rule.code === 'no_retake' ? 403 : 409
      return NextResponse.json({ error: { code: rule.code, message: rule.message } }, { status })
    }
    if (rule.kind === 'resume') {
      const t = await db.query.attempts.findFirst({ where: eq(attempts.id, rule.attemptId) })
      return NextResponse.json({ attemptId: rule.attemptId, deadlineAt: t?.deadlineAt ?? null, resumed: true })
    }
    if (rule.kind === 'created') return NextResponse.json({ attemptId: rule.attemptId, deadlineAt: rule.deadlineAt, resumed: false })
    return NextResponse.json({ error: { code: 'internal', message: '创建失败' } }, { status: 500 })
  }

  if (typeof body.paperId !== 'string' || !body.paperId) {
    return NextResponse.json({ error: { code: 'bad_request', message: '缺少 paperId 或 assignmentId' } }, { status: 400 })
  }
  const mode = body.mode
  if (mode !== 'practice' && mode !== 'exam') {
    return NextResponse.json({ error: { code: 'bad_request', message: 'mode 需为 practice / exam' } }, { status: 400 })
  }
  const paper = await db.query.papers.findFirst({ where: eq(papers.id, body.paperId) })
  if (!paper) return NextResponse.json({ error: { code: 'not_found', message: '试卷不存在' } }, { status: 404 })

  if (mode === 'exam') {
    // 断线续答:同人同卷未交的自由模考直接返回原 attempt(倒计时不重置)。
    const ongoing = await db.query.attempts.findFirst({
      where: and(
        eq(attempts.userId, userId),
        eq(attempts.paperId, paper.id),
        eq(attempts.mode, 'exam'),
        eq(attempts.status, 'in_progress'),
        isNull(attempts.assignmentId),
      ),
    })
    if (ongoing) {
      return NextResponse.json({ attemptId: ongoing.id, deadlineAt: ongoing.deadlineAt, resumed: true })
    }
    const deadlineAt = new Date(Date.now() + paper.durationMinutes * 60_000)
    const [row] = await db
      .insert(attempts)
      .values({ userId, paperId: paper.id, mode: 'exam', deadlineAt })
      .returning({ id: attempts.id })
    if (!row) return NextResponse.json({ error: { code: 'internal', message: '创建失败' } }, { status: 500 })
    return NextResponse.json({ attemptId: row.id, deadlineAt, resumed: false })
  }

  const [row] = await db
    .insert(attempts)
    .values({ userId, paperId: paper.id, mode: 'practice' })
    .returning({ id: attempts.id })
  if (!row) return NextResponse.json({ error: { code: 'internal', message: '创建失败' } }, { status: 500 })
  return NextResponse.json({ attemptId: row.id })
}
