import { z } from 'zod'
import { AiError, extractJson, type AiCaller } from '@/lib/ai/client'
import { loadPrompt } from '@/lib/ai/prompts'
import type { Paper } from '@/lib/schema/paper'
import type { DraftIssue } from './draft'

// AI 结构化(SPEC §8 导入向导第三步、§5.4):按题组把规则草稿交给模型补全参考答案 / 解析 / 标签 / 难度。
// 模型只能填空,不能改题号或增删小题;confidence < 0.6 的题在校对页标红。

export const aiParsedItemSchema = z.object({
  number: z.number().int().positive(),
  answer: z.record(z.string(), z.unknown()),
  explanation: z.string().optional(),
  knowledgeTags: z.array(z.string()).default([]),
  difficulty: z.number().int().min(1).max(3).default(2),
  confidence: z.number().min(0).max(1).default(0.5),
  contentFix: z.record(z.string(), z.unknown()).optional(),
})
export const aiParseResultSchema = z.object({ items: z.array(aiParsedItemSchema) })
export type AiParsedItem = z.infer<typeof aiParsedItemSchema>

type Section = Paper['sections'][number]
type Group = Section['groups'][number]

export function buildParseUser(section: Section, group: Group, answerKey?: string | null): string {
  const parts: string[] = []
  parts.push(`大题:${section.code} ${section.title}(题型 ${section.itemType},每题 ${section.scorePerItem} 分)`)
  parts.push(`说明:${section.instructions}`)
  if (group.stimulus) parts.push(`材料${group.stimulus.title ? `(${group.stimulus.title})` : ''}:\n${group.stimulus.body}`)
  if (group.frame) parts.push(`框架(含空位):\n${group.frame}`)
  const items = group.items.map((it) => ({ number: it.number, type: it.type, score: it.score, content: it.content, ...(it.contextSnippet ? { contextSnippet: it.contextSnippet } : {}) }))
  parts.push(`小题草稿:\n${JSON.stringify(items, null, 0)}`)
  if (answerKey) parts.push(`试卷附带的参考答案原文(优先采用,按题号对应;没有对应题号的不要编造):\n${answerKey.slice(0, 6000)}`)
  return parts.join('\n\n')
}

export async function parseGroupWithAi(ai: AiCaller, model: string, section: Section, group: Group, answerKey?: string | null): Promise<AiParsedItem[]> {
  const out = await ai({ model, system: loadPrompt('parse-paper'), user: buildParseUser(section, group, answerKey), maxTokens: 2400 })
  const parsed = aiParseResultSchema.safeParse(extractJson(out.text))
  if (!parsed.success) throw new AiError('AI 返回结构不合法', 'bad_response')
  return parsed.data.items
}

/** 把 AI 结果合并进试卷草稿(按题号匹配;不改题号、不增删)。返回问题列表(低置信度 / 未匹配)。 */
export function mergeAiItems(paper: Paper, sectionIndex: number, groupIndex: number, items: AiParsedItem[]): DraftIssue[] {
  const issues: DraftIssue[] = []
  const group = paper.sections[sectionIndex]?.groups[groupIndex]
  if (!group) return issues
  const byNumber = new Map(items.map((i) => [i.number, i]))
  group.items.forEach((it, ii) => {
    const path = `sections.${sectionIndex}.groups.${groupIndex}.items.${ii}`
    const ai = byNumber.get(it.number)
    if (!ai) {
      issues.push({ path, message: 'AI 没有返回这题的答案', source: 'ai' })
      return
    }
    const target = it as unknown as Record<string, unknown>
    target.answer = ai.answer
    if (ai.explanation) target.explanation = ai.explanation
    if (ai.knowledgeTags.length) target.knowledgeTags = ai.knowledgeTags
    target.difficulty = ai.difficulty
    if (ai.contentFix && typeof target.content === 'object' && target.content) {
      target.content = { ...(target.content as Record<string, unknown>), ...ai.contentFix }
      issues.push({ path: `${path}.content`, message: 'AI 建议更正题干,请核对', source: 'ai' })
    }
    target.origin = 'official'
    if (ai.confidence < 0.6) issues.push({ path: `${path}.answer`, message: `AI 对答案没把握(置信 ${Math.round(ai.confidence * 100)}%),请核对`, source: 'ai' })
  })
  return issues
}
