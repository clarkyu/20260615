import { z } from 'zod'
import type { Item } from '@/lib/schema/paper'
import { normalizeText } from '@/lib/grading/normalize'

// AI 变式题 / 干扰项生成(SPEC §6 脚手架、§8 题库管理、§10 M6):用户消息拼装与结果约束。
// 变式题只能以草稿进入(items.status=draft、origin=ai),教师审核通过才会被训练抽到;干扰项由教师采纳后写入 content。

const line = (label: string, value: string | number) => `${label}:${value}`
const block = (label: string, value: string) => `${label}:\n${value}`

export function buildGenerateUser(item: Item, ctx: { stimulus?: string | null; count?: number }): string {
  const parts: string[] = [line('题型', item.type), line('满分', item.score), line('难度', item.difficulty)]
  parts.push(block('题目内容(JSON)', JSON.stringify(item.content, null, 0)))
  parts.push(block('参考答案(JSON)', JSON.stringify(item.answer, null, 0)))
  if (item.explanation) parts.push(line('解析', item.explanation))
  if (item.knowledgeTags.length) parts.push(line('知识点', item.knowledgeTags.join('、')))
  if (item.contextSnippet) parts.push(line('上下文片段', item.contextSnippet))
  if (ctx.stimulus) parts.push(block('材料原文', ctx.stimulus.slice(0, 2000)))
  if (ctx.count) parts.push(line('需要生成的变式题数量', ctx.count))
  return parts.join('\n')
}

export const distractorsResultSchema = z.object({ distractors: z.array(z.string().trim().min(1).max(40)).min(1).max(6) })

const variantBase = { explanation: z.string().trim().min(1).max(400), knowledgeTags: z.array(z.string().trim().min(1).max(30)).max(6).default([]), difficulty: z.number().int().min(1).max(3).default(2) }
export const variantSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('fill'),
    content: z.object({ blank: z.number().int().positive().default(1), hint: z.string().trim().max(40).optional(), maxWords: z.number().int().positive().max(3).default(1), distractors: z.array(z.string().trim().min(1).max(40)).max(6).default([]) }),
    contextSnippet: z.string().trim().min(5).max(400),
    answer: z.object({ accepted: z.array(z.string().trim().min(1).max(40)).min(1).max(8) }),
    ...variantBase,
  }),
  z.object({
    type: z.literal('translate_c2e_fill'),
    content: z.object({ zh: z.string().trim().min(2).max(200), frame: z.string().trim().min(5).max(400), hint: z.string().trim().max(40).optional(), maxWords: z.number().int().positive().max(5).default(2), distractors: z.array(z.string().trim().min(1).max(40)).max(6).default([]) }),
    answer: z.object({ accepted: z.array(z.string().trim().min(1).max(60)).min(1).max(8) }),
    ...variantBase,
  }),
  z.object({
    type: z.literal('reorder'),
    content: z.object({ chunks: z.array(z.string().trim().min(1).max(60)).min(2).max(8) }),
    answer: z.object({ accepted: z.array(z.string().trim().min(2).max(200)).min(1).max(4) }),
    ...variantBase,
  }),
])
export const variantsResultSchema = z.object({ items: z.array(variantSchema).min(1).max(8) })
export type Variant = z.infer<typeof variantSchema>

/** 干扰项清洗:去掉与任何可接受答案相同(规范化后)的、去重、最多 3 个。 */
export function cleanDistractors(raw: string[], accepted: string[]): string[] {
  const acc = new Set(accepted.map((a) => normalizeText(a)))
  const out: string[] = []
  const seen = new Set<string>()
  for (const d of raw) {
    const n = normalizeText(d)
    if (!n || acc.has(n) || seen.has(n)) continue
    seen.add(n)
    out.push(d.trim())
    if (out.length === 3) break
  }
  return out
}

/** 变式题自检:fill 的片段要含 {{1}},汉译英框架要含 {{blank}};干扰项不与答案重合;词块能拼出答案。 */
export function validateVariant(v: Variant): string | null {
  if (v.type === 'fill' && !v.contextSnippet.includes('{{1}}')) return '填空片段缺少 {{1}} 空位'
  if (v.type === 'translate_c2e_fill' && !v.content.frame.includes('{{blank}}')) return '英文框架缺少 {{blank}} 空位'
  if (v.type === 'reorder') {
    const words = v.content.chunks.join(' ').replace(/[^A-Za-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ')
    const target = (v.answer.accepted[0] ?? '').replace(/[^A-Za-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ')
    if (words.toLowerCase() !== target.toLowerCase()) return '词块拼不出参考答案'
  }
  return null
}
