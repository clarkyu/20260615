import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import { getSession, type SessionUser } from './session'
import { getDb } from '@/lib/db/client'
import { ensureUser } from '@/lib/db/queries'

// 教师端鉴权(SPEC §9.4:教师接口要求 role 为 teacher 或 admin)。
// API 用 requireTeacherApi(返回 401/403 响应或 users.id);页面用 requireTeacherPage(重定向)。

export type TeacherCtx = { user: SessionUser; userId: string }

export async function requireTeacherApi(): Promise<{ ok: true; ctx: TeacherCtx } | { ok: false; res: NextResponse }> {
  const session = await getSession()
  if (!session.user) {
    return { ok: false, res: NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 }) }
  }
  if (session.user.role !== 'teacher' && session.user.role !== 'admin') {
    return { ok: false, res: NextResponse.json({ error: { code: 'forbidden', message: '仅教师可用' } }, { status: 403 }) }
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
