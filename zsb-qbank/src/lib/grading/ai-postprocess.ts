import { z } from 'zod'

// AI 评分结果的服务端硬性约束(SPEC §5.3):纯函数,表驱动测试。
//   score 限制在 0..满分并按 0.5 步进;作文低于 minWords 按 rubric 扣「字数」维度并记 issue;
//   confidence < 0.6 或调用失败 → needs_review;返回结构不合法 → 视为失败。

export const REVIEW_CONFIDENCE = 0.6

export const aiGradeResultSchema = z.object({
  score: z.number(),
  keyPointsHit: z.array(z.string()).default([]),
  issues: z.array(z.string()).default([]),
  feedback: z.string().default(''),
  confidence: z.number().default(0.5),
})
export type AiGradeResult = z.infer<typeof aiGradeResultSchema>

export const aiExplainResultSchema = z.object({
  explanation: z.string().min(1),
  knowledgeTags: z.array(z.string()).default([]),
  difficulty: z.number().int().min(1).max(3).default(2),
  commonMistakes: z.array(z.string()).default([]),
})
export type AiExplainResult = z.infer<typeof aiExplainResultSchema>

/** 0..fullScore 之间、0.5 步进;非数值按 0。 */
export function clampScore(raw: number, fullScore: number): number {
  if (!Number.isFinite(raw)) return 0
  const stepped = Math.round(raw * 2) / 2
  return Math.min(fullScore, Math.max(0, stepped))
}

/** confidence 不在 [0,1] 内按 0 处理(触发复核)。 */
export function normalizeConfidence(c: number): number {
  if (!Number.isFinite(c) || c < 0 || c > 1) return 0
  return c
}

export function shouldNeedReview(confidence: number): boolean {
  return normalizeConfidence(confidence) < REVIEW_CONFIDENCE
}

/** 解析并约束 AI 评分结果;结构不合法返回 ok:false(调用方按失败处理)。 */
export function postprocessAiGrade(
  raw: unknown,
  fullScore: number,
): { ok: true; result: AiGradeResult; needsReview: boolean } | { ok: false; error: string } {
  const parsed = aiGradeResultSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'AI 返回结构不合法' }
  const confidence = normalizeConfidence(parsed.data.confidence)
  const result: AiGradeResult = {
    ...parsed.data,
    score: clampScore(parsed.data.score, fullScore),
    confidence,
    feedback: parsed.data.feedback.trim(),
  }
  return { ok: true, result, needsReview: shouldNeedReview(confidence) }
}

export interface WritingRubricDim {
  name: string
  maxScore: number
}

/**
 * 作文字数不足(SPEC §5.3):「字数」维度(名称含"字数"或"词数")不得分;rubric 无该维度时
 * 视为满分的 10%(至少 0.5)。实现为**封顶**而非减法:总分不得超过「满分 − 字数维度」——
 * 模型已按提示词把该维度记 0 的不再扣,模型没扣的强制扣,不会双重扣分。
 * issues 里已注明字数问题的不重复添加。
 */
export function applyWritingWordFloor(
  result: AiGradeResult,
  words: number,
  minWords: number,
  fullScore: number,
  rubric: WritingRubricDim[],
): AiGradeResult {
  if (words >= minWords) return result
  const dim = rubric.find((d) => /字数|词数/.test(d.name))
  const penalty = dim ? dim.maxScore : Math.max(0.5, Math.round((fullScore * 0.1) * 2) / 2)
  const cap = clampScore(fullScore - penalty, fullScore)
  const issue = `字数不足：实际 ${words} 词，要求不少于 ${minWords} 词`
  const issues = result.issues.some((i) => /字数|词数/.test(i)) ? result.issues : [...result.issues, issue]
  return { ...result, score: Math.min(result.score, cap), issues }
}

/** 汉译英兜底二值化(SPEC §5.2):AI 只回答是否可接受——满分或 0,没有中间分。 */
export function foldBinary(score: number, fullScore: number): number {
  return score >= fullScore ? fullScore : 0
}

// 提示词注入启发式:学生答案里出现对阅卷者的指令/分数要求时,强制教师复核且不入缓存
// (提示词本身也要求模型忽略,这里是服务端第二道防线;宁可多送复核,不让注入拿满分)。
const INJECTION_PATTERNS: RegExp[] = [
  /<\/?student_answer>/i,
  /"?(score|confidence)"?\s*[:=]\s*[\d.]/i,
  /\b(give|return|output|set|award)\b[^.\n]{0,20}\b(full|max(imum)?|highest)\b[^.\n]{0,12}\b(score|marks?|points?)\b/i,
  /\bignore\b[^.\n]{0,20}\b(previous|above|prior|earlier)\b[^.\n]{0,12}\b(instructions?|rules?|prompt)\b/i,
  /(阅卷|评分|评卷|打分|置信度|满分)[^。\n]{0,12}(请|务必|一律|设为|返回|给|=|：|:)/,
  /忽略(以上|上述|之前|前面)[^。\n]{0,8}(指令|规则|要求|提示)/,
]
export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text))
}

/** 同一小题、同一规范化答案的 AI 结果按哈希缓存(§5.3):NFKC、去首尾、折叠空白、小写。 */
export function normalizeAnswerForCache(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}
