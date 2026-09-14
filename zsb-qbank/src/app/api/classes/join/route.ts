import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db/client'
import { ensureUser } from '@/lib/db/queries'
import { joinClassByCode } from '@/lib/db/assignments'
import { rateLimit } from '@/lib/rate-limit'
import { getSession } from '@/lib/auth/session'

// POST /api/classes/join { code }:学生用六位加入码入班(幂等;SPEC §8)。限速防猜码。
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })
  if (!rateLimit(`join:${session.user.sub}`, 20)) {
    return NextResponse.json({ error: { code: 'rate_limited', message: '试得太频繁了，歇一会儿再来' } }, { status: 429 })
  }
  let body: { code?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: '请求体不是 JSON' } }, { status: 400 })
  }
  if (typeof body.code !== 'string') return NextResponse.json({ error: { code: 'bad_request', message: '请输入加入码' } }, { status: 400 })
  const db = getDb()
  const userId = await ensureUser(db, session.user)
  const cls = await joinClassByCode(db, { code: body.code, userId })
  if (!cls) return NextResponse.json({ error: { code: 'not_found', message: '加入码不对，再核对一下' } }, { status: 404 })
  return NextResponse.json({ class: { id: cls.id, name: cls.name } })
}
