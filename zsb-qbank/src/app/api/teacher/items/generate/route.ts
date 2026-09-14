import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { items } from '@/lib/db/schema'
import { enqueueGenerateJob } from '@/lib/db/ai-jobs'
import { requireTeacherApi } from '@/lib/auth/teacher'
import { rateLimit } from '@/lib/rate-limit'

const bodySchema = z.object({
  itemId: z.uuid(),
  mode: z.enum(['variants', 'distractors']).default('variants'),
  count: z.number().int().min(1).max(5).default(3),
})

// POST /api/teacher/items/generate(SPEC §9.4 / §8 / M6):AI 生成变式题(草稿入库,审核后才被训练抽到)
// 或一级脚手架的干扰项(结果存任务,教师采纳后写入 content.distractors)。返回 jobId,GET /api/teacher/jobs/:id 取结果。
export async function POST(req: NextRequest) {
  const auth = await requireTeacherApi(req)
  if (!auth.ok) return auth.res
  if (!rateLimit(`generate:${auth.ctx.user.sub}`, 30)) {
    return NextResponse.json({ error: { code: 'rate_limited', message: '操作太频繁，稍后再试' } }, { status: 429 })
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
  const item = await db.query.items.findFirst({ where: eq(items.id, parsed.data.itemId) })
  if (!item) return NextResponse.json({ error: { code: 'not_found', message: '小题不存在' } }, { status: 404 })
  if (!['fill', 'translate_c2e_fill', 'reorder'].includes(item.type)) {
    return NextResponse.json({ error: { code: 'bad_request', message: '只有填词、汉译英、连词成句可以生成变式' } }, { status: 400 })
  }
  if (parsed.data.mode === 'distractors' && item.type === 'reorder') {
    return NextResponse.json({ error: { code: 'bad_request', message: '连词成句没有干扰项脚手架' } }, { status: 400 })
  }
  const jobId = await enqueueGenerateJob(db, { itemId: item.id, mode: parsed.data.mode, count: parsed.data.count, createdBy: auth.ctx.userId })
  return NextResponse.json({ jobId })
}
