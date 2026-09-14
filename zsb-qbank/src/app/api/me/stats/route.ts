import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { ensureUser } from '@/lib/db/queries'
import { myStats } from '@/lib/db/training'
import { getSession } from '@/lib/auth/session'

// GET /api/me/stats(SPEC §9.4):我的题型得分率、错题数、复习到期数、今日任务进度。
export async function GET() {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })
  const db = getDb()
  const userId = await ensureUser(db, session.user)
  return NextResponse.json(await myStats(db, userId))
}
