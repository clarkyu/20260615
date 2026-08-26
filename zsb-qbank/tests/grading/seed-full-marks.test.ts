import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { paperSchema, type Item, type StudentAnswer } from '@/lib/schema/paper'
import { gradeObjective, isObjectiveType } from '@/lib/grading/objective'
import { wordSequence } from '@/lib/grading/normalize'

// 硬约束 2 / SPEC §5.5:种子试卷的每个客观题都要有「参考答案得满分」的用例,
// 防止答案键与判分规则脱节。fill/translate_c2e_fill 逐个 accepted 全验;
// reorder 通过穷举词块排列找出能拼出参考句的下标序列(词块 ≤5,穷举安全)。

const seed = paperSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', '..', 'seed', 'paper-2025-hubei-english.json'), 'utf-8')),
)
const items = seed.sections.flatMap((s) => s.groups.flatMap((g) => g.items))
const objective = items.filter((it) => isObjectiveType(it.type))

function* permutations(n: number): Generator<number[]> {
  const arr = Array.from({ length: n }, (_, i) => i)
  function* helper(k: number): Generator<number[]> {
    if (k === n) {
      yield [...arr]
      return
    }
    for (let i = k; i < n; i++) {
      ;[arr[k], arr[i]] = [arr[i]!, arr[k]!]
      yield* helper(k + 1)
      ;[arr[k], arr[i]] = [arr[i]!, arr[k]!]
    }
  }
  yield* helper(0)
}

function referenceAnswers(it: Item): StudentAnswer[] {
  if (it.type === 'fill' || it.type === 'translate_c2e_fill') {
    return it.answer.accepted.map((a) => ({ type: 'text', value: a }))
  }
  if (it.type === 'reorder') {
    const out: StudentAnswer[] = []
    for (const acc of it.answer.accepted) {
      const want = wordSequence(acc)
      for (const perm of permutations(it.content.chunks.length)) {
        const got = wordSequence(perm.map((i) => it.content.chunks[i]).join(' '))
        if (got.length === want.length && got.every((w, i) => w === want[i])) {
          out.push({ type: 'sequence', chunkIndexes: perm })
          break
        }
      }
    }
    return out
  }
  if (it.type === 'single_choice' || it.type === 'multi_choice' || it.type === 'true_false') {
    return [{ type: 'choice', keys: it.answer.correct }]
  }
  return []
}

describe('种子试卷客观题:参考答案必得满分', () => {
  it('客观题共 32 个(10 短文填空 + 6 连词成句 + 10 阅读填词 + 6 汉译英)', () => {
    expect(objective).toHaveLength(32)
  })

  it.each(objective.map((it) => [it.number, it] as const))('第 %i 题参考答案满分', (_n, it) => {
    const refs = referenceAnswers(it)
    expect(refs.length).toBeGreaterThan(0) // reorder 的每个参考句都必须能由词块拼出
    for (const ref of refs) {
      const r = gradeObjective(it, ref)
      expect(r.verdict).toBe('correct')
      expect(r.score).toBe(it.score)
    }
  })
})
