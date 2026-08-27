import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { attempts, papers } from '@/lib/db/schema'
import { ensureUser } from '@/lib/db/queries'
import { getSession } from '@/lib/auth/session'

// POST /api/attempts:开始作答。M3 支持 { paperId, mode: 'practice' | 'exam' };
// 考试模式设服务端 deadlineAt(硬约束 6)并返回。自由模考(无 assignment)有未交的
// 旧考试则续答同一 attempt(断线续答),交过的不挡新开(docs/DECISIONS.md D9);
// assignment 考试的「默认不可重做」在任务链路(M5/M6)强制。
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })

  let body: { paperId?: unknown; mode?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: '请求体不是 JSON' } }, { status: 400 })
  }
  if (typeof body.paperId !== 'string' || !body.paperId) {
    return NextResponse.json({ error: { code: 'bad_request', message: '缺少 paperId' } }, { status: 400 })
  }
  const mode = body.mode
  if (mode !== 'practice' && mode !== 'exam') {
    return NextResponse.json({ error: { code: 'bad_request', message: 'mode 需为 practice / exam' } }, { status: 400 })
  }

  const db = getDb()
  const paper = await db.query.papers.findFirst({ where: eq(papers.id, body.paperId) })
  if (!paper) return NextResponse.json({ error: { code: 'not_found', message: '试卷不存在' } }, { status: 404 })

  const userId = await ensureUser(db, session.user)

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
