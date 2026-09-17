import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXAM_HUBEI_2025 } from '@/lib/data/exam-hubei-2025'
import { parseFillBlank } from '@/lib/fill-blank'

// 2025 湖北专升本真题在这个仓库里有**两份**转写:
//   · 本项目的 `src/lib/data/exam-hubei-2025.ts`(作业模板)
//   · zsb-qbank 的 `seed/paper-2025-hubei-english.json`(题库种子)
// 两份都是给学生判分用的。答案键一旦分叉,同一个学生答案在两个产品里判分不同 ——
// 而且分叉是静默的:各自的用例都绿。
//
// 2026-09-17 第一次对的时候真分叉了一处:第 22 题本项目接受 wrong / wrongly,
// zsb-qbank 只接受 wrong(学生写 wrongly 被判错)。已统一,这条用例防它再分。
//
// 只对**客观题**:主观题(连词成句 / 阅读问答 / 作文)两边一个是 rubric 文本、一个是
// reference + keyPoints,形态不同,没法逐字比,也不该逐字比。

const SEED = join(__dirname, '..', '..', '..', 'zsb-qbank', 'seed', 'paper-2025-hubei-english.json')

interface SeedItem {
  number: number
  answer?: { accepted?: string[] }
}

/** fillBlank 环节按顺序对应的题号:短文填空 1–10、阅读填词 17–21 / 22–26、汉译英 37–42。 */
const PHASE_NUMBERS: number[][] = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  [17, 18, 19, 20, 21],
  [22, 23, 24, 25, 26],
  [37, 38, 39, 40, 41, 42],
]

function seedAnswers(): Map<number, string[]> {
  const raw = JSON.parse(readFileSync(SEED, 'utf-8')) as {
    sections: { groups: { items: SeedItem[] }[] }[]
  }
  const out = new Map<number, string[]>()
  for (const s of raw.sections) for (const g of s.groups) for (const it of g.items) {
    if (it.answer?.accepted) out.set(it.number, it.answer.accepted)
  }
  return out
}

const norm = (xs: string[]) => [...xs].map((x) => x.trim().toLowerCase()).sort()

describe('2025 真题:两份转写的客观题答案键必须一致', () => {
  const fb = EXAM_HUBEI_2025.phases.filter((p) => p.fillBlank)
  const seed = seedAnswers()

  it('两边都解析得出东西(这条不过,底下的比对就是空转)', () => {
    expect(fb).toHaveLength(PHASE_NUMBERS.length)
    expect(fb.map((p) => p.weight)).toEqual([20, 10, 10, 18])
    expect(seed.size).toBeGreaterThanOrEqual(26)
    expect(seed.get(1)).toEqual(['biggest'])
  })

  it('逐题对答案键', () => {
    let compared = 0
    const diffs: string[] = []
    for (const [i, phase] of fb.entries()) {
      const accept = parseFillBlank(phase.blanksJson).accept
      const numbers = PHASE_NUMBERS[i]!
      expect(accept, `第 ${i + 1} 个填空环节的空数`).toHaveLength(numbers.length)
      for (const [j, n] of numbers.entries()) {
        const mine = accept[j]!
        const theirs = seed.get(n)
        if (!theirs) {
          diffs.push(`第 ${n} 题:zsb-qbank 种子里没有答案键`)
          continue
        }
        compared++
        if (norm(mine).join('|') !== norm(theirs).join('|')) {
          diffs.push(`第 ${n} 题:本项目 ${JSON.stringify(mine)} ≠ zsb-qbank ${JSON.stringify(theirs)}`)
        }
      }
    }
    expect(compared, '实际比对的题数').toBe(26)
    expect(diffs, `两份转写的答案键分叉了(改一处要两处一起改):\n${diffs.join('\n')}`).toEqual([])
  })
})
