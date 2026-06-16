import { describe, it, expect } from 'vitest'
import { parseChunks, serializeChunks, splitIntoSets, slugHash, type ChunkInput } from '@/lib/bank'

const chunk = (en: string): ChunkInput => ({ english: en, chinese: null, meaningEn: null, meaningZh: null, exampleEn: null, exampleZh: null })

describe('splitIntoSets', () => {
  it('returns a single set when it fits or perSet<=0', () => {
    const cs = [chunk('a'), chunk('b')]
    expect(splitIntoSets('Pack', cs, 50)).toEqual([{ name: 'Pack', chunks: cs, sourceKey: `pack:${slugHash('Pack')}` }])
    expect(splitIntoSets('Pack', cs, 0)[0].chunks).toHaveLength(2)
  })

  it('splits into named ranges of perSet with stable, unique source keys', () => {
    const cs = Array.from({ length: 120 }, (_, i) => chunk(`c${i}`))
    const sets = splitIntoSets('商务口语', cs, 50)
    expect(sets.map((s) => s.chunks.length)).toEqual([50, 50, 20])
    expect(sets.map((s) => s.name)).toEqual(['商务口语 · 0001–0050', '商务口语 · 0051–0100', '商务口语 · 0101–0120'])
    expect(new Set(sets.map((s) => s.sourceKey)).size).toBe(3)
    // idempotent: same name → same keys
    expect(splitIntoSets('商务口语', cs, 50).map((s) => s.sourceKey)).toEqual(sets.map((s) => s.sourceKey))
  })

  it('derives a non-empty ascii slug even for CJK-only names', () => {
    expect(slugHash('商务口语')).toMatch(/^[a-z0-9]+$/)
    expect(slugHash('a') === slugHash('b')).toBe(false)
  })
})

describe('parseChunks', () => {
  it('parses three-part bilingual blocks separated by blank lines', () => {
    const raw = [
      '51. Time flies. | 时光飞逝',
      'Means: Used to say that time passes very quickly. | 用来表示时间过得非常快。',
      'Example: I can\'t believe it\'s already December. Time flies! | 真不敢相信已经十二月了，时光飞逝！',
      '',
      'Let\'s call it a day. | 今天到此为止',
      'To stop working for the day. | 今天不再继续工作。',
      'Let\'s call it a day and go home. | 收工回家吧。',
    ].join('\n')
    const out = parseChunks(raw)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      english: 'Time flies.',
      chinese: '时光飞逝',
      meaningEn: 'Used to say that time passes very quickly.',
      meaningZh: '用来表示时间过得非常快。',
      exampleEn: "I can't believe it's already December. Time flies!",
      exampleZh: '真不敢相信已经十二月了，时光飞逝！',
    })
    expect(out[1].english).toBe("Let's call it a day.")
  })

  it('tolerates missing parts and missing translations', () => {
    const out = parseChunks('Good morning\t早上好\nA greeting in the morning.')
    expect(out).toEqual([
      {
        english: 'Good morning',
        chinese: '早上好',
        meaningEn: 'A greeting in the morning.',
        meaningZh: null,
        exampleEn: null,
        exampleZh: null,
      },
    ])
  })

  it('drops empty-core blocks', () => {
    expect(parseChunks('\n\n  \n')).toEqual([])
  })
})

describe('serializeChunks round-trip', () => {
  it('parse(serialize(chunks)) returns the same chunks', () => {
    const chunks = [
      { english: 'Time flies.', chinese: '时光飞逝', meaningEn: 'Time passes quickly.', meaningZh: '时间过得快。', exampleEn: 'Time flies!', exampleZh: '时间过得真快！' },
      { english: 'Get rid of.', chinese: '摆脱', meaningEn: 'To remove something.', meaningZh: null, exampleEn: null, exampleZh: null },
    ]
    expect(parseChunks(serializeChunks(chunks))).toEqual(chunks)
  })
})
