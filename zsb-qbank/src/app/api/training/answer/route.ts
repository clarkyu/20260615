import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { ensureUser } from '@/lib/db/queries'
import { answerTraining } from '@/lib/db/training'
import { studentAnswerSchema } from '@/lib/schema/paper'
import { rateLimit } from '@/lib/rate-limit'
import { getSession } from '@/lib/auth/session'

const bodySchema = z.object({ itemId: z.uuid(), answer: studentAnswerSchema })

// POST /api/training/answer(SPEC §9.4):训练作答,每题即判(§6):返回对错、参考答案、解析,并更新
// 脚手架等级与复习卡;汉译英未命中词表交 AI 兜底(返回 pending,客户端轮询 /api/attempts/:id/feedback)。
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })
  if (!rateLimit(`train:${session.user.sub}`, 120)) {
    return NextResponse.json({ error: { code: 'rate_limited', message: '操作太频繁，歇一会儿再试' } }, { status: 429 })
  }
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: '请求体不是 JSON' } }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: { code: 'bad_request', message: '参数不正确' } }, { status: 400 })
  const db = getDb()
  const userId = await ensureUser(db, session.user)
  const out = await answerTraining(db, userId, parsed.data)
  if ('error' in out) {
    const status = out.error === 'not_found' ? 404 : 400
    const message = out.error === 'not_found' ? '题目不存在' : out.error === 'not_trainable' ? '这题不能在训练里作答' : '题目数据异常，请联系老师'
    return NextResponse.json({ error: { code: out.error, message } }, { status })
  }
  return NextResponse.json(out)
}
