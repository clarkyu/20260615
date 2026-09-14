import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { ensureUser } from '@/lib/db/queries'
import { pickTrainingItems, TRAINABLE_TYPES } from '@/lib/db/training'
import { getSession } from '@/lib/auth/session'

const qSchema = z.object({
  mode: z.enum(['daily', 'review', 'targeted']).default('daily'),
  type: z.enum(TRAINABLE_TYPES).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  count: z.coerce.number().int().min(1).max(30).default(10),
  exclude: z.array(z.uuid()).max(200).default([]),
})

// GET /api/training/next(SPEC §9.4):训练模式抽题。mode=daily(今日任务)/ review(到期复习)/ targeted
// (专项:type、tags)。返回的小题已剥离答案与干扰项;脚手架提示按每人每题的等级生成(§6);
// 默认只带 contextSnippet,材料与框架一并返回供「展开全文」。
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session.user) return NextResponse.json({ error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const parsed = qSchema.safeParse({
    mode: sp.get('mode') || undefined,
    type: sp.get('type') || undefined,
    tags: (sp.get('tags') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    count: sp.get('count') || undefined,
    exclude: (sp.get('exclude') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  })
  if (!parsed.success) return NextResponse.json({ error: { code: 'bad_request', message: '参数不正确' } }, { status: 400 })
  const db = getDb()
  const userId = await ensureUser(db, session.user)
  const items = await pickTrainingItems(db, userId, parsed.data)
  return NextResponse.json({ items, serverNow: new Date().toISOString() })
}
