import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { ensureUser } from '@/lib/db/queries'
import { dueReviews } from '@/lib/db/training'
import { getSession } from '@/lib/auth/session'

// GET /api/review(SPEC §9.4):到期复习卡(错题本里今天该复习的题)+ 未到期数。
export async function GET() {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })
  const db = getDb()
  const userId = await ensureUser(db, session.user)
  const out = await dueReviews(db, userId)
  return NextResponse.json({ ...out, serverNow: new Date().toISOString() })
}
