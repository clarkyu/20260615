import { describe, it, expect } from 'vitest'
import { parseRubricPoints, serializeRubricPoints, rubricMaxScore, composeRubric } from '../rubric'

describe('parseRubricPoints', () => {
  it('parses a valid points array', () => {
    expect(parseRubricPoints('[{"name":"完整度","points":40},{"name":"发音","points":20}]')).toEqual([
      { name: '完整度', points: 40 },
      { name: '发音', points: 20 },
    ])
  })
  it('drops malformed items (missing/empty name, non-finite/negative points) and rounds', () => {
    expect(
      parseRubricPoints('[{"name":"完整度","points":40.6},{"name":"","points":10},{"name":"x","points":-1},{"points":5},{"name":"y","points":"z"}]'),
    ).toEqual([{ name: '完整度', points: 41 }])
  })
  it('returns [] for null / empty / non-array / corrupt JSON', () => {
    expect(parseRubricPoints(null)).toEqual([])
    expect(parseRubricPoints(undefined)).toEqual([])
    expect(parseRubricPoints('')).toEqual([])
    expect(parseRubricPoints('{"name":"x","points":1}')).toEqual([]) // object, not array
    expect(parseRubricPoints('not json')).toEqual([])
  })
})

describe('serializeRubricPoints', () => {
  it('round-trips a valid array (normalizing) to a compact JSON string', () => {
    expect(serializeRubricPoints([{ name: '完整度', points: 40.4 }, { name: '发音', points: 20 }])).toBe(
      '[{"name":"完整度","points":40},{"name":"发音","points":20}]',
    )
  })
  it('drops empty/invalid rows and returns null when nothing survives', () => {
    expect(serializeRubricPoints([{ name: '', points: 10 }, { name: 'x', points: -1 }])).toBeNull()
    expect(serializeRubricPoints([])).toBeNull()
  })
})

describe('rubricMaxScore', () => {
  it('sums the points; null when there are no dimensions', () => {
    expect(rubricMaxScore([{ name: '完整度', points: 40 }, { name: '发音', points: 20 }])).toBe(60)
    expect(rubricMaxScore([])).toBeNull()
  })
})

describe('composeRubric', () => {
  it('renders the 分值 detail + max onto the criteria, and returns the summed maxScore', () => {
    const r = composeRubric('按四维评分。', [
      { name: '完整度', points: 40 },
      { name: '准确度', points: 20 },
      { name: '发音', points: 20 },
      { name: '流利度', points: 20 },
    ])
    expect(r.maxScore).toBe(100)
    expect(r.text).toContain('按四维评分。')
    expect(r.text).toContain('完整度 40、准确度 20、发音 20、流利度 20')
    expect(r.text).toContain('满分 100')
  })
  it('with no 分值, returns the criteria unchanged and a null maxScore (caller uses default)', () => {
    expect(composeRubric('自由评分。', [])).toEqual({ text: '自由评分。', maxScore: null })
  })
})
