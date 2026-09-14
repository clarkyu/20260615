import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { ensureUser } from '@/lib/db/queries'
import { studentAssignments } from '@/lib/db/assignments'
import { getSession } from '@/lib/auth/session'

// GET /api/assignments:学生「我的任务」(所在班级的任务 + 本人作答状态与开放期;SPEC §9.4)。
export async function GET() {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })
  const db = getDb()
  const userId = await ensureUser(db, session.user)
  const list = await studentAssignments(db, userId)
  return NextResponse.json({ assignments: list, serverNow: new Date().toISOString() })
}
