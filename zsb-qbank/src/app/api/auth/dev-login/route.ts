import { NextResponse, type NextRequest } from 'next/server'
import { getSession } from '@/lib/auth/session'

// 开发环境本地账号登录(SPEC §9.1):AUTH_DEV_LOGIN=true 时可用,生产必须关闭。
// POST { role: 'student' | 'teacher' | 'admin', name? }
export async function POST(req: NextRequest) {
  if (process.env.AUTH_DEV_LOGIN !== 'true') {
    return NextResponse.json({ error: { code: 'forbidden', message: '开发登录未开启' } }, { status: 403 })
  }
  let body: { role?: unknown; name?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: '请求体不是 JSON' } }, { status: 400 })
  }
  const role = body.role
  if (role !== 'student' && role !== 'teacher' && role !== 'admin') {
    return NextResponse.json({ error: { code: 'bad_request', message: 'role 需为 student / teacher / admin' } }, { status: 400 })
  }
  const session = await getSession()
  session.user = { sub: `dev-${role}`, role, name: typeof body.name === 'string' && body.name ? body.name : `开发${role}` }
  await session.save()
  return NextResponse.json({ ok: true, user: session.user })
}
