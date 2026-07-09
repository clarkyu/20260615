// 语块(chunk)评分：中心句为基础 + 解释句/情景例句加分。
//
// Native English 2000 之类的「句子背诵/跟读」题库，每个语块是一组三件套：
//   中心句(english) —— 核心短语，唯一「要求」背/读的；
//   解释句(meaningEn) —— 英文释义，选做；
//   情景例句(exampleEn) —— 完整例句，选做。
// clark 的规则：基础分只按【中心句】评（背出中心句主体即高分，不背解释/情景不扣）；
// 学生若还复述了【解释句】+10、【情景例句】+10，累计封顶 +20。
//
// 落地思路与「合规 ±10」同源：LLM 只做**判断**（中心句四维基础分 + 有没有复述解释/情景两个 flag），
// 不可靠的**算术**（+10/+10、封顶、夹 0~满分）一律交给这里的纯函数——可单测、可复盘。

import type { ReferenceSentence } from '@/lib/ai/types'

export interface ChunkItem {
  order: number
  central: string // 中心句（english）——基础分对着它评
  explanation?: string // 解释句（meaningEn）——复述 +10
  example?: string // 情景例句（exampleEn）——复述 +10
}

// 加分步长：解释句 / 情景例句 各 +10；两者都做到即 +20（封顶由「只两项」天然保证）。
export const CHUNK_BONUS_STEP = 10

// 基础分的参照句子 = 各语块的【中心句】（判分只按中心句评四维）。
export function chunkCentralReferences(chunks: ChunkItem[]): ReferenceSentence[] {
  return chunks.map((c) => ({ order: c.order, text: c.central }))
}

// 把三件套逐条附给判分（让它据此判定学生有没有复述解释句/情景例句）。
export function chunkReferenceBlock(chunks: ChunkItem[]): string {
  return chunks
    .map((c) => {
      const parts = [`${c.order}. 中心句：${c.central}`]
      if (c.explanation) parts.push(`解释句：${c.explanation}`)
      if (c.example) parts.push(`情景例句：${c.example}`)
      return parts.join(' ｜ ')
    })
    .join('\n')
}

// 组合判分 rubric：基础四维只按中心句评；三件套逐条列出；要求判分在 breakdown 里**额外**回两个
// 复述判定项（1/0，不计入 score）。加分的算术不交给 LLM——它只回 flag，代码据此加分。
export function buildChunkRubric(baseRubric: string, chunks: ChunkItem[]): string {
  return [
    baseRubric,
    '',
    '本环节题库每条为「中心句 + 解释句 + 情景例句」三件套，逐条如下（学生**只被要求**背/读中心句）：',
    chunkReferenceBlock(chunks),
    '',
    'score 只按上列【中心句】给（完整度/准确度/发音/流利，0~满分）；学生没背解释句/情景例句不要扣分。',
    '另在 breakdown 里**额外**给这两项（points 只填 1 或 0，且不要计入 score）：',
    '  - dimension "解释句复述"：学生是否复述了多数条目的【解释句】(是=1/否=0)；',
    '  - dimension "情景例句复述"：学生是否完整复述了多数条目的【情景例句】(是=1/否=0)。',
  ].join('\n')
}

export interface BonusFlags {
  explanationRecited: boolean
  exampleRecited: boolean
}

// 从判分 breakdown 读出两个复述 flag（缺失/非数值一律按「没复述」——加分从不无中生有）。
export function readBonusFlags(breakdown: Record<string, number> | undefined | null): BonusFlags {
  const b = breakdown ?? {}
  return {
    explanationRecited: Number(b['解释句复述']) >= 1,
    exampleRecited: Number(b['情景例句复述']) >= 1,
  }
}

// 加分（纯算术，代码算）：复述解释句 +10、复述情景例句 +10（封顶 +20）。返回增量 + 中文说明，
// 由编排层在中心句基础分之上确定性地加、再夹到 0~满分。
export function chunkBonus(flags: BonusFlags): { delta: number; notes: string[] } {
  const notes: string[] = []
  let delta = 0
  if (flags.explanationRecited) {
    delta += CHUNK_BONUS_STEP
    notes.push(`复述解释句 +${CHUNK_BONUS_STEP}`)
  }
  if (flags.exampleRecited) {
    delta += CHUNK_BONUS_STEP
    notes.push(`复述情景例句 +${CHUNK_BONUS_STEP}`)
  }
  if (delta === 0) notes.push('未复述解释句/情景例句（不加分）')
  return { delta, notes }
}
