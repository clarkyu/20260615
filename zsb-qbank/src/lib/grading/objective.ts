import type { Item, StudentAnswer } from '@/lib/schema/paper'
import { normalizeText, wordCount, wordSequence, levenshtein } from './normalize'

// 客观题判分(SPEC §5.2):纯函数,不碰数据库与网络。
// verdict 语义:
//   correct        —— 满分
//   wrong          —— 0 分(有作答但不匹配;translate_c2e_fill 由调用方决定是否走 AI 兜底)
//   too_many_words —— 0 分,词数超限
//   empty          —— 0 分,未作答
//   not_objective  —— 本模块不判(主观题走 AI/教师)

export type ObjectiveVerdict = 'correct' | 'wrong' | 'too_many_words' | 'empty' | 'not_objective'

export interface ObjectiveResult {
  verdict: ObjectiveVerdict
  score: number
  /** 规范化后的学生答案(用于常见错答统计;empty/not_objective 为空串) */
  normalized: string
  /** translate_c2e_fill 专用:未命中且非超词/空 → 建议进入 AI 兜底 */
  aiFallbackEligible?: boolean
}

export interface GradeOptions {
  /** 教师为单题开启的「容错 1 字符」(仅练习/训练;考试模式调用方必须传 false) */
  fuzzy?: boolean
}

function textOf(answer: StudentAnswer): string | null {
  return answer.type === 'text' ? answer.value : null
}

// fill 与 translate_c2e_fill 共用的「词表匹配」内核。
function matchAccepted(
  raw: string,
  accepted: string[],
  acceptedPatterns: string[] | undefined,
  caseSensitive: boolean | undefined,
  fuzzy: boolean,
): boolean {
  const norm = normalizeText(raw, { caseSensitive })
  for (const a of accepted) {
    if (normalizeText(a, { caseSensitive }) === norm) return true
  }
  if (acceptedPatterns) {
    for (const p of acceptedPatterns) {
      try {
        const re = new RegExp(`^(?:${p})$`, caseSensitive ? '' : 'i')
        if (re.test(norm)) return true
      } catch {
        // 坏正则按不匹配处理(导入侧应校验;判分绝不抛)
      }
    }
  }
  if (fuzzy) {
    for (const a of accepted) {
      if (levenshtein(normalizeText(a, { caseSensitive }), norm) <= 1) return true
    }
  }
  return false
}

export function gradeObjective(item: Item, answer: StudentAnswer, opts: GradeOptions = {}): ObjectiveResult {
  const fuzzy = opts.fuzzy === true

  switch (item.type) {
    case 'fill': {
      const raw = textOf(answer)
      if (raw === null || raw.trim() === '') return { verdict: 'empty', score: 0, normalized: '' }
      if (wordCount(raw) > item.content.maxWords) {
        return { verdict: 'too_many_words', score: 0, normalized: normalizeText(raw) }
      }
      const ok = matchAccepted(raw, item.answer.accepted, item.answer.acceptedPatterns, item.answer.caseSensitive, fuzzy)
      return { verdict: ok ? 'correct' : 'wrong', score: ok ? item.score : 0, normalized: normalizeText(raw, { caseSensitive: item.answer.caseSensitive }) }
    }

    case 'translate_c2e_fill': {
      const raw = textOf(answer)
      if (raw === null || raw.trim() === '') return { verdict: 'empty', score: 0, normalized: '' }
      if (wordCount(raw) > item.content.maxWords) {
        return { verdict: 'too_many_words', score: 0, normalized: normalizeText(raw) }
      }
      const ok = matchAccepted(raw, item.answer.accepted, item.answer.acceptedPatterns, undefined, fuzzy)
      return {
        verdict: ok ? 'correct' : 'wrong',
        score: ok ? item.score : 0,
        normalized: normalizeText(raw),
        // 未命中 ≠ 一定错(SPEC §5.2):交由调用方走 AI 兜底;AI 不可用时记 0 并 needs_review。
        aiFallbackEligible: !ok,
      }
    }

    case 'reorder': {
      if (answer.type !== 'sequence') return { verdict: 'empty', score: 0, normalized: '' }
      const chunks = item.content.chunks
      if (answer.chunkIndexes.length === 0) return { verdict: 'empty', score: 0, normalized: '' }
      // 序列必须恰好用完全部词块、无重复、下标合法。
      const seen = new Set<number>()
      for (const i of answer.chunkIndexes) {
        if (i < 0 || i >= chunks.length || seen.has(i)) {
          return { verdict: 'wrong', score: 0, normalized: '' }
        }
        seen.add(i)
      }
      if (seen.size !== chunks.length) return { verdict: 'wrong', score: 0, normalized: '' }
      const sentence = answer.chunkIndexes.map((i) => chunks[i]).join(' ')
      const got = wordSequence(sentence)
      const ok = item.answer.accepted.some((acc) => {
        const want = wordSequence(acc)
        return want.length === got.length && want.every((w, i) => w === got[i])
      })
      return { verdict: ok ? 'correct' : 'wrong', score: ok ? item.score : 0, normalized: got.join(' ') }
    }

    case 'single_choice':
    case 'true_false': {
      if (answer.type !== 'choice' || answer.keys.length === 0) return { verdict: 'empty', score: 0, normalized: '' }
      const ok = answer.keys.length === 1 && item.answer.correct.length === 1 && answer.keys[0] === item.answer.correct[0]
      return { verdict: ok ? 'correct' : 'wrong', score: ok ? item.score : 0, normalized: answer.keys.join(',') }
    }

    case 'multi_choice': {
      if (answer.type !== 'choice' || answer.keys.length === 0) return { verdict: 'empty', score: 0, normalized: '' }
      const got = [...new Set(answer.keys)].sort()
      const want = [...new Set(item.answer.correct)].sort()
      const exact = got.length === want.length && want.every((k, i) => k === got[i])
      if (exact) return { verdict: 'correct', score: item.score, normalized: got.join(',') }
      // 默认全对得满分、否则 0(漏选按比例给分为可配置扩展,首期不开)。
      return { verdict: 'wrong', score: 0, normalized: got.join(',') }
    }

    default:
      return { verdict: 'not_objective', score: 0, normalized: '' }
  }
}

export function isObjectiveType(type: Item['type']): boolean {
  return (
    type === 'fill' ||
    type === 'reorder' ||
    type === 'translate_c2e_fill' ||
    type === 'single_choice' ||
    type === 'multi_choice' ||
    type === 'true_false'
  )
}
