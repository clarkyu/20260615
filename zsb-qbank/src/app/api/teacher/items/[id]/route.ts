import { NextResponse, type NextRequest } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { aiGradeCache, items, papers, wrongAnswers } from '@/lib/db/schema'
import { itemSchema } from '@/lib/schema/paper'
import { requireTeacherApi } from '@/lib/auth/teacher'
import { isUuid } from '@/lib/uuid'

const patchSchema = z.object({
  content: z.record(z.string(), z.unknown()).optional(),
  answer: z.record(z.string(), z.unknown()).optional(),
  explanation: z.string().nullable().optional(),
  knowledgeTags: z.array(z.string().trim().min(1)).max(20).optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  status: z.enum(['draft', 'approved']).optional(),
  score: z.number().positive().optional(),
})

// PUT /api/teacher/items/:id(SPEC §9.4 / §8 题库管理):小题编辑——内容 / 答案 / 解析 / 标签 / 难度 / 状态。
// 合并后整题过 itemSchema(唯一事实来源),坏数据进不了库;不改题号与所属试卷。
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTeacherApi(req)
  if (!auth.ok) return auth.res
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: { code: 'not_found', message: '小题不存在' } }, { status: 404 })
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: '请求体不是 JSON' } }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: { code: 'bad_request', message: '参数不正确' } }, { status: 400 })
  const db = getDb()
  const row = await db.query.items.findFirst({ where: eq(items.id, id) })
  if (!row) return NextResponse.json({ error: { code: 'not_found', message: '小题不存在' } }, { status: 404 })
  const p = parsed.data
  const merged = itemSchema.safeParse({
    number: row.number,
    type: row.type,
    score: p.score ?? row.score,
    explanation: p.explanation === undefined ? (row.explanation ?? undefined) : (p.explanation ?? undefined),
    knowledgeTags: p.knowledgeTags ?? row.knowledgeTags,
    difficulty: p.difficulty ?? (row.difficulty as 1 | 2 | 3),
    contextSnippet: row.contextSnippet ?? undefined,
    content: p.content ? { ...(row.content as Record<string, unknown>), ...p.content } : row.content,
    answer: p.answer ?? row.answer,
    origin: row.origin,
    status: p.status ?? row.status,
  })
  if (!merged.success) {
    return NextResponse.json({ error: { code: 'invalid', message: '修改后的小题未通过校验' }, issues: merged.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, { status: 400 })
  }
  const it = merged.data
  const answerChanged = JSON.stringify(it.answer) !== JSON.stringify(row.answer) || JSON.stringify(it.content) !== JSON.stringify(row.content)
  const scoreChanged = it.score !== row.score
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(items)
      .set({ score: it.score, explanation: it.explanation ?? null, knowledgeTags: it.knowledgeTags, difficulty: it.difficulty, content: it.content, answer: it.answer, status: it.status ?? row.status, updatedAt: new Date() })
      .where(eq(items.id, id))
      .returning({ id: items.id, number: items.number, updatedAt: items.updatedAt })
    // 参考答案 / 题干 / 分值变了:旧的 AI 评分缓存与常见错答统计都是按旧答案键算的,一并作废,
    // 否则后来的学生会命中缓存拿到按旧答案判的分。已落库的作答不回溯(教师在批改队列改分)。
    if (answerChanged || scoreChanged) {
      await tx.delete(aiGradeCache).where(eq(aiGradeCache.itemId, id))
      if (answerChanged) await tx.delete(wrongAnswers).where(eq(wrongAnswers.itemId, id))
    }
    // 分值变了:试卷满分跟着重算。
    if (scoreChanged) {
      await tx
        .update(papers)
        .set({ totalScore: sql`(select coalesce(sum(${items.score}), 0) from ${items} where ${items.paperId} = ${row.paperId})`, updatedAt: new Date() })
        .where(eq(papers.id, row.paperId))
    }
    return u
  })
  return NextResponse.json({ ok: true, item: updated, invalidated: answerChanged || scoreChanged })
}

// DELETE /api/teacher/items/:id:只允许删除 AI 变式草稿(status=draft 且 origin=ai);真题小题不可删。
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTeacherApi(req)
  if (!auth.ok) return auth.res
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: { code: 'not_found', message: '小题不存在' } }, { status: 404 })
  const db = getDb()
  const row = await db.query.items.findFirst({ where: eq(items.id, id) })
  if (!row) return NextResponse.json({ error: { code: 'not_found', message: '小题不存在' } }, { status: 404 })
  if (row.status !== 'draft' || row.origin !== 'ai') {
    return NextResponse.json({ error: { code: 'forbidden', message: '只能删除 AI 生成的草稿题' } }, { status: 403 })
  }
  await db.delete(items).where(eq(items.id, id))
  return NextResponse.json({ ok: true })
}
