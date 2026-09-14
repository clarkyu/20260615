import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { attempts, items, papers, responses } from '@/lib/db/schema'
import { assemblePaper } from '@/lib/db/queries'
import { upsertPaper } from '@/lib/db/import-paper'
import { recomputeTotal, validateDraft } from '@/lib/import/draft'
import { requireTeacherApi } from '@/lib/auth/teacher'

// GET /api/teacher/papers/:id:教师看整卷装配树(含参考答案与解析——教师端允许,SPEC §9.4
// 「教师接口要求 role 为 teacher」;学生接口仍走 stripAssembledAnswers)。组卷勾选小题用它取题单。
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTeacherApi()
  if (!auth.ok) return auth.res
  const { id } = await ctx.params
  const paper = await assemblePaper(getDb(), id)
  if (!paper) return NextResponse.json({ error: { code: 'not_found', message: '试卷不存在' } }, { status: 404 })
  return NextResponse.json({ paper })
}

// PUT /api/teacher/papers/:id(SPEC §9.4):整卷写入——导入向导校对后发布,或整卷重导。
// 请求体 = §4 试卷 JSON(zod 唯一事实来源),校验失败按路径返回问题;已有作答记录的试卷不允许整卷
// 重建(小题会换 id,作答与任务会失联),提示改用小题编辑。
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTeacherApi()
  if (!auth.ok) return auth.res
  const { id } = await ctx.params
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: '请求体不是 JSON' } }, { status: 400 })
  }
  if (!raw || typeof raw !== 'object' || (raw as { id?: unknown }).id !== id) {
    return NextResponse.json({ error: { code: 'bad_request', message: '试卷 id 与路径不一致' } }, { status: 400 })
  }
  const v = validateDraft(raw)
  if (!v.ok || !v.paper) return NextResponse.json({ error: { code: 'invalid', message: '试卷内容未通过校验' }, issues: v.issues }, { status: 400 })
  const db = getDb()
  const existing = await db.query.papers.findFirst({ where: eq(papers.id, id) })
  if (existing) {
    const [used] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(responses)
      .innerJoin(items, eq(responses.itemId, items.id))
      .where(eq(items.paperId, id))
    const [tries] = await db.select({ n: sql<number>`count(*)::int` }).from(attempts).where(and(eq(attempts.paperId, id), inArray(attempts.status, ['in_progress', 'submitted', 'graded', 'released'])))
    if ((used?.n ?? 0) > 0 || (tries?.n ?? 0) > 0) {
      return NextResponse.json({ error: { code: 'conflict', message: '该试卷已有学生作答记录，不能整卷重建；请换一个试卷 id 另存，或用小题编辑修改' } }, { status: 409 })
    }
  }
  const paper = recomputeTotal(v.paper)
  const got = await upsertPaper(db, paper, { createdBy: auth.ctx.userId })
  return NextResponse.json({ ok: true, paper: { id: got.paperId, sections: got.sections, groups: got.groups, items: got.items, totalScore: got.scoreSum }, created: !existing }, { status: existing ? 200 : 201 })
}

// PATCH /api/teacher/papers/:id { status }:草稿 / 发布 / 归档流转(不动题目)。
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTeacherApi()
  if (!auth.ok) return auth.res
  const { id } = await ctx.params
  let body: { status?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: '请求体不是 JSON' } }, { status: 400 })
  }
  if (body.status !== 'draft' && body.status !== 'published' && body.status !== 'archived') {
    return NextResponse.json({ error: { code: 'bad_request', message: 'status 需为 draft / published / archived' } }, { status: 400 })
  }
  const rows = await getDb().update(papers).set({ status: body.status, updatedAt: new Date() }).where(eq(papers.id, id)).returning({ id: papers.id, status: papers.status })
  if (rows.length === 0) return NextResponse.json({ error: { code: 'not_found', message: '试卷不存在' } }, { status: 404 })
  return NextResponse.json({ ok: true, paper: rows[0] })
}
