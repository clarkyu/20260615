import { itemSchema, type Item } from '@/lib/schema/paper'
import type { items } from './schema'

/** DB 行 → schema Item(内容 / 答案 JSONB 过 zod;坏数据返回 null,调用方按「题目数据异常」处理而不是判错学生)。 */
export function parseItemRow(row: typeof items.$inferSelect): Item | null {
  const parsed = itemSchema.safeParse({
    number: row.number,
    type: row.type,
    score: row.score,
    explanation: row.explanation ?? undefined,
    knowledgeTags: row.knowledgeTags,
    difficulty: row.difficulty as 1 | 2 | 3,
    contextSnippet: row.contextSnippet ?? undefined,
    content: row.content,
    answer: row.answer,
  })
  return parsed.success ? parsed.data : null
}
