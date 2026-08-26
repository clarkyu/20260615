import { z } from 'zod'

// 内容模型的唯一事实来源(SPEC §4.4):种子导入、API 入参、数据库 JSONB 列共用本文件。
// 改模型先改这里,再改其余(CLAUDE.md 硬约束 4)。

export const paperStatusSchema = z.enum(['draft', 'published', 'archived'])
export const groupKindSchema = z.enum(['cloze', 'reading_fill', 'reading_qa', 'standalone'])
export const itemTypeSchema = z.enum([
  'fill',
  'reorder',
  'short_answer',
  'translate_e2c',
  'translate_c2e_fill',
  'writing',
  'single_choice',
  'multi_choice',
  'true_false',
])
export type ItemType = z.infer<typeof itemTypeSchema>

const itemBase = {
  number: z.number().int().positive(),
  score: z.number().positive(),
  explanation: z.string().optional(),
  knowledgeTags: z.array(z.string()).default([]),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  contextSnippet: z.string().optional(),
  origin: z.enum(['official', 'teacher', 'ai']).optional(),
  status: z.enum(['draft', 'approved']).optional(),
}

export const fillItemSchema = z.object({
  ...itemBase,
  type: z.literal('fill'),
  content: z.object({ blank: z.number().int().positive(), hint: z.string().optional(), maxWords: z.number().int().positive() }),
  answer: z.object({
    accepted: z.array(z.string()).min(1),
    acceptedPatterns: z.array(z.string()).optional(),
    caseSensitive: z.boolean().optional(),
  }),
})

export const reorderItemSchema = z.object({
  ...itemBase,
  type: z.literal('reorder'),
  content: z.object({ chunks: z.array(z.string()).min(2) }),
  answer: z.object({ accepted: z.array(z.string()).min(1) }),
})

const subjectiveAnswer = z.object({ reference: z.string(), keyPoints: z.array(z.string()), rubric: z.string() })

export const shortAnswerItemSchema = z.object({
  ...itemBase,
  type: z.literal('short_answer'),
  content: z.object({ question: z.string() }),
  answer: subjectiveAnswer,
})

export const translateE2CItemSchema = z.object({
  ...itemBase,
  type: z.literal('translate_e2c'),
  content: z.object({ source: z.string() }),
  answer: subjectiveAnswer,
})

export const translateC2EFillItemSchema = z.object({
  ...itemBase,
  type: z.literal('translate_c2e_fill'),
  content: z.object({
    zh: z.string(),
    frame: z.string(),
    hint: z.string().optional(),
    maxWords: z.number().int().positive(),
  }),
  answer: z.object({ accepted: z.array(z.string()).min(1), acceptedPatterns: z.array(z.string()).optional() }),
})

export const writingItemSchema = z.object({
  ...itemBase,
  type: z.literal('writing'),
  content: z.object({
    genre: z.string(),
    persona: z.string().optional(),
    prompt: z.string(),
    requirements: z.array(z.string()),
    minWords: z.number().int().positive(),
    maxWords: z.number().int().positive().optional(),
  }),
  answer: z.object({
    sample: z.string(),
    rubric: z.array(z.object({ name: z.string(), maxScore: z.number().positive(), desc: z.string() })),
  }),
})

export const choiceItemSchema = z.object({
  ...itemBase,
  type: z.enum(['single_choice', 'multi_choice', 'true_false']),
  content: z.object({ stem: z.string(), options: z.array(z.object({ key: z.string(), text: z.string() })).min(2) }),
  answer: z.object({ correct: z.array(z.string()).min(1) }),
})

export const itemSchema = z.discriminatedUnion('type', [
  fillItemSchema,
  reorderItemSchema,
  shortAnswerItemSchema,
  translateE2CItemSchema,
  translateC2EFillItemSchema,
  writingItemSchema,
  choiceItemSchema,
])
export type Item = z.infer<typeof itemSchema>

export const stimulusSchema = z.object({
  kind: z.enum(['passage', 'letter', 'notes', 'dialogue']),
  title: z.string().optional(),
  body: z.string(),
})

export const groupSchema = z.object({
  order: z.number().int().positive(),
  kind: groupKindSchema,
  stimulus: stimulusSchema.optional(),
  frame: z.string().optional(),
  items: z.array(itemSchema).min(1),
})
export type Group = z.infer<typeof groupSchema>

export const sectionSchema = z.object({
  order: z.number().int().positive(),
  code: z.string(),
  title: z.string(),
  instructions: z.string(),
  itemType: itemTypeSchema,
  scorePerItem: z.number().positive(),
  groups: z.array(groupSchema).min(1),
})
export type Section = z.infer<typeof sectionSchema>

export const paperSchema = z.object({
  schemaVersion: z.number().int().positive().optional(),
  id: z.string().min(1),
  title: z.string().min(1),
  year: z.number().int(),
  region: z.string(),
  source: z.string().optional(),
  totalScore: z.number().positive(),
  durationMinutes: z.number().int().positive(),
  status: paperStatusSchema,
  answerKeyNote: z.string().optional(),
  sections: z.array(sectionSchema).min(1),
})
export type Paper = z.infer<typeof paperSchema>

// ── 学生作答(responses.answer 列) ────────────────────────────────────────────
export const studentAnswerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), value: z.string() }),
  z.object({ type: z.literal('sequence'), chunkIndexes: z.array(z.number().int().nonnegative()) }),
  z.object({ type: z.literal('choice'), keys: z.array(z.string()) }),
])
export type StudentAnswer = z.infer<typeof studentAnswerSchema>

// ── 剥离答案(CLAUDE.md 硬约束 1) ──────────────────────────────────────────────
// 所有把试卷内容发往客户端的接口都必须经过本函数:去掉 answer 与 explanation
// (解析只在判分反馈里下发),其余字段原样保留。返回全新对象,不改入参。
export type ClientItem = Omit<Item, 'answer' | 'explanation'>
export type ClientGroup = Omit<Group, 'items'> & { items: ClientItem[] }
export type ClientSection = Omit<Section, 'groups'> & { groups: ClientGroup[] }
export type ClientPaper = Omit<Paper, 'sections'> & { sections: ClientSection[] }

export function stripAnswers(paper: Paper): ClientPaper {
  return {
    ...paper,
    sections: paper.sections.map((s) => ({
      ...s,
      groups: s.groups.map((g) => ({
        ...g,
        items: g.items.map((it) => {
          const rest: Record<string, unknown> = { ...it }
          delete rest.answer
          delete rest.explanation
          return rest as unknown as ClientItem
        }),
      })),
    })),
  }
}
