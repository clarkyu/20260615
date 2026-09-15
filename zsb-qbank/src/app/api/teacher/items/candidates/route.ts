import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { acceptedCandidates, resolveCandidates } from '@/lib/db/item-bank'
import { requireTeacherApi } from '@/lib/auth/teacher'
import { isUuid } from '@/lib/uuid'

// accepted 候选(SPEC §8):AI 兜底判「可接受」但答案键里没有的学生答案。
// GET  ?paperId=&itemId=   列出候选
// POST { itemId, adopt: [], reject: [] }  采纳写进答案键 / 拒绝记为错答

export async function GET(req: NextRequest) {
  const auth = await requireTeacherApi()
  if (!auth.ok) return auth.res
  const sp = req.nextUrl.searchParams
  const paperId = sp.get('paperId') || undefined
  const itemId = sp.get('itemId') || undefined
  if (itemId && !isUuid(itemId)) return NextResponse.json({ error: { code: 'bad_request', message: '参数不正确' } }, { status: 400 })
  const rows = await acceptedCandidates(getDb(), { paperId, itemId })
  return NextResponse.json({ items: rows })
}

const bodySchema = z.object({
  itemId: z.string().min(1),
  adopt: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  reject: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
})

export async function POST(req: NextRequest) {
  const auth = await requireTeacherApi(req)
  if (!auth.ok) return auth.res
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: '请求体不是 JSON' } }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: { code: 'bad_request', message: '参数不正确' } }, { status: 400 })
  const { itemId, adopt, reject } = parsed.data
  if (!isUuid(itemId)) return NextResponse.json({ error: { code: 'not_found', message: '小题不存在' } }, { status: 404 })
  if ((adopt?.length ?? 0) === 0 && (reject?.length ?? 0) === 0) {
    return NextResponse.json({ error: { code: 'bad_request', message: '没有要处理的候选' } }, { status: 400 })
  }
  const out = await resolveCandidates(getDb(), itemId, { adopt, reject })
  if (!out.ok) return NextResponse.json({ error: { code: 'invalid', message: out.error } }, { status: 400 })
  return NextResponse.json(out)
}
