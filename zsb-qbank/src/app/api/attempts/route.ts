import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { attempts, papers } from '@/lib/db/schema'
import { ensureUser } from '@/lib/db/queries'
import { getSession } from '@/lib/auth/session'

// POST /api/attempts:开始作答。M2 支持 { paperId, mode: 'practice' };
// assignment 与考试模式在 M3 接入(考试将返回服务端 deadlineAt)。
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
  if (body.mode !== 'practice') {
    return NextResponse.json({ error: { code: 'bad_request', message: 'M2 仅支持 practice 模式' } }, { status: 400 })
  }

  const db = getDb()
  const paper = await db.query.papers.findFirst({ where: eq(papers.id, body.paperId) })
  if (!paper) return NextResponse.json({ error: { code: 'not_found', message: '试卷不存在' } }, { status: 404 })

  const userId = await ensureUser(db, session.user)
  const [row] = await db
    .insert(attempts)
    .values({ userId, paperId: paper.id, mode: 'practice' })
    .returning({ id: attempts.id })
  if (!row) return NextResponse.json({ error: { code: 'internal', message: '创建失败' } }, { status: 500 })
  return NextResponse.json({ attemptId: row.id })
}
