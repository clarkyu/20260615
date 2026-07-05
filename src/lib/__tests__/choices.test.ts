import { describe, it, expect } from 'vitest'
import { parseChoices, sameChoiceSet } from '@/lib/choices'

describe('parseChoices', () => {
  it('parses a JSON string array, dropping non-strings; tolerant of junk', () => {
    expect(parseChoices(JSON.stringify(['A', 'B']))).toEqual(['A', 'B'])
    expect(parseChoices(null)).toEqual([])
    expect(parseChoices('')).toEqual([])
    expect(parseChoices('not json')).toEqual([])
    expect(parseChoices(JSON.stringify(['A', 1, null, 'B']))).toEqual(['A', 'B'])
    expect(parseChoices(JSON.stringify({ a: 1 }))).toEqual([])
  })
})

describe('sameChoiceSet — multi-select all-or-nothing judging core', () => {
  it('is true iff the two lists are the same set (order/dupes/whitespace-insensitive)', () => {
    expect(sameChoiceSet(['A', 'B'], ['B', 'A'])).toBe(true)
    expect(sameChoiceSet([' A ', 'B'], ['A', 'B'])).toBe(true)
    expect(sameChoiceSet(['A', 'A', 'B'], ['A', 'B'])).toBe(true)
    expect(sameChoiceSet(['A', '', '  '], ['A'])).toBe(true) // empties dropped
  })
  it('is false on a missing, extra, or different pick', () => {
    expect(sameChoiceSet(['A'], ['A', 'B'])).toBe(false) // missing one
    expect(sameChoiceSet(['A', 'B', 'C'], ['A', 'B'])).toBe(false) // one extra
    expect(sameChoiceSet(['A', 'C'], ['A', 'B'])).toBe(false) // wrong one
    expect(sameChoiceSet([], ['A'])).toBe(false)
    expect(sameChoiceSet(['A'], [])).toBe(false)
  })
})
