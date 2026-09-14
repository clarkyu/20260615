import { NextResponse, type NextRequest } from 'next/server'
import { redirect } from 'next/navigation'
import { getSession, type SessionUser } from './session'
import { getDb } from '@/lib/db/client'
import { ensureUser } from '@/lib/db/queries'
import { rateLimit } from '@/lib/rate-limit'

// 教师端鉴权(SPEC §9.4:教师接口要求 role 为 teacher 或 admin)。
// API 用 requireTeacherApi(返回 401/403 响应或 users.id);页面用 requireTeacherPage(重定向)。
// 传入 req 时,非 GET 请求按用户限速(§9.5:写接口每分钟 120 次)。

export type TeacherCtx = { user: SessionUser; userId: string }

export const TEACHER_WRITE_LIMIT = 120

export async function requireTeacherApi(req?: NextRequest): Promise<{ ok: true; ctx: TeacherCtx } | { ok: false; res: NextResponse }> {
  const session = await getSession()
  if (!session.user) {
    return { ok: false, res: NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 }) }
  }
  if (session.user.role !== 'teacher' && session.user.role !== 'admin') {
    return { ok: false, res: NextResponse.json({ error: { code: 'forbidden', message: '仅教师可用' } }, { status: 403 }) }
  }
  if (req && req.method !== 'GET' && req.method !== 'HEAD' && !rateLimit(`teacher-write:${session.user.sub}`, TEACHER_WRITE_LIMIT)) {
    return { ok: false, res: NextResponse.json({ error: { code: 'rate_limited', message: '操作太频繁，稍后再试' } }, { status: 429 }) }
  }
  const userId = await ensureUser(getDb(), session.user)
  return { ok: true, ctx: { user: session.user, userId } }
}

export async function requireTeacherPage(): Promise<TeacherCtx> {
  const session = await getSession()
  if (!session.user) redirect('/teacher/login')
  if (session.user.role !== 'teacher' && session.user.role !== 'admin') redirect('/')
  const userId = await ensureUser(getDb(), session.user)
  return { user: session.user, userId }
}
