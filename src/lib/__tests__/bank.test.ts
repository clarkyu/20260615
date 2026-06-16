import { describe, it, expect } from 'vitest'
import { parseChunks, serializeChunks } from '@/lib/bank'

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
