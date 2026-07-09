import { describe, it, expect } from 'vitest'
import {
  type ChunkItem,
  CHUNK_BONUS_STEP,
  chunkCentralReferences,
  chunkReferenceBlock,
  buildChunkRubric,
  readBonusFlags,
  chunkBonus,
} from '../chunk-grading'

const CHUNKS: ChunkItem[] = [
  { order: 1, central: "What's up?", explanation: 'A casual greeting.', example: "Hey, what's up?" },
  { order: 2, central: 'Long time no see.', explanation: "Haven't met for a while.", example: 'Oh, long time no see!' },
]

describe('chunkCentralReferences', () => {
  it('uses the central sentence (中心句) as the base reference', () => {
    expect(chunkCentralReferences(CHUNKS)).toEqual([
      { order: 1, text: "What's up?" },
      { order: 2, text: 'Long time no see.' },
    ])
  })
})

describe('chunkReferenceBlock', () => {
  it('lists 中心/解释/情景 per item, and omits absent optional parts', () => {
    const block = chunkReferenceBlock([
      { order: 1, central: 'Core.', explanation: 'Def.', example: 'Ex.' },
      { order: 2, central: 'Only core.' }, // no explanation/example
    ])
    expect(block).toContain('1. 中心句：Core. ｜ 解释句：Def. ｜ 情景例句：Ex.')
    expect(block).toContain('2. 中心句：Only core.')
    expect(block).not.toContain('2. 中心句：Only core. ｜') // no trailing separators when absent
  })
})

describe('buildChunkRubric', () => {
  it('keeps the base rubric, appends the chunk list, and asks for the two recital flags', () => {
    const r = buildChunkRubric('基础四维评分。', CHUNKS)
    expect(r).toContain('基础四维评分。')
    expect(r).toContain("What's up?")
    expect(r).toContain('解释句复述')
    expect(r).toContain('情景例句复述')
    expect(r).toContain('不要计入 score')
  })
})

describe('readBonusFlags', () => {
  it('reads the two recital flags from the judge breakdown (>=1 → true)', () => {
    expect(readBonusFlags({ 解释句复述: 1, 情景例句复述: 0 })).toEqual({ explanationRecited: true, exampleRecited: false })
    expect(readBonusFlags({ 解释句复述: 0, 情景例句复述: 1 })).toEqual({ explanationRecited: false, exampleRecited: true })
  })
  it('treats missing / undefined breakdown as no bonus (never invents a bonus)', () => {
    expect(readBonusFlags(undefined)).toEqual({ explanationRecited: false, exampleRecited: false })
    expect(readBonusFlags({})).toEqual({ explanationRecited: false, exampleRecited: false })
    expect(readBonusFlags({ 发音: 20 })).toEqual({ explanationRecited: false, exampleRecited: false })
  })
})

describe('chunkBonus', () => {
  it('awards +10 per recited optional part, capped at +20 by construction', () => {
    expect(chunkBonus({ explanationRecited: false, exampleRecited: false }).delta).toBe(0)
    expect(chunkBonus({ explanationRecited: true, exampleRecited: false }).delta).toBe(CHUNK_BONUS_STEP)
    expect(chunkBonus({ explanationRecited: false, exampleRecited: true }).delta).toBe(CHUNK_BONUS_STEP)
    expect(chunkBonus({ explanationRecited: true, exampleRecited: true }).delta).toBe(2 * CHUNK_BONUS_STEP)
  })
  it('explains the adjustment in the notes (both the awarded and the none case)', () => {
    expect(chunkBonus({ explanationRecited: true, exampleRecited: true }).notes).toEqual([
      `复述解释句 +${CHUNK_BONUS_STEP}`,
      `复述情景例句 +${CHUNK_BONUS_STEP}`,
    ])
    expect(chunkBonus({ explanationRecited: false, exampleRecited: false }).notes).toEqual(['未复述解释句/情景例句（不加分）'])
  })
})
