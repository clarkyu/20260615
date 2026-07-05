import { describe, it, expect } from 'vitest'
import { parseFillBlank, blankCount, splitBlanks, gradeFillBlank, isGradableFillBlank } from '@/lib/fill-blank'

describe('blankCount / splitBlanks', () => {
  it('counts ____ (≥3 underscores) markers and splits around them', () => {
    expect(blankCount('a ____ b ____ c')).toBe(2)
    expect(blankCount('no blanks here')).toBe(0)
    expect(blankCount('two __ underscores is not a blank')).toBe(0) // <3
    expect(splitBlanks('a ____ b')).toEqual(['a ', ' b']) // n+1 segments for n blanks
    expect(splitBlanks('x').length - 1).toBe(0)
  })
})

describe('parseFillBlank', () => {
  it('parses {text, accept}; tolerant of junk', () => {
    expect(parseFillBlank(JSON.stringify({ text: 'a ____', accept: [['x', 'y']] }))).toEqual({ text: 'a ____', accept: [['x', 'y']] })
    expect(parseFillBlank(null)).toEqual({ text: '', accept: [] })
    expect(parseFillBlank('not json')).toEqual({ text: '', accept: [] })
    // non-string entries filtered out of each accept list
    expect(parseFillBlank(JSON.stringify({ text: 't', accept: [['a', 1, null], 'nope'] }))).toEqual({ text: 't', accept: [['a'], []] })
  })
})

describe('gradeFillBlank — per-blank case/space-insensitive, multiple accepted', () => {
  const accept = [['H2O', 'water', '水'], ['oxygen', 'O2']]
  it('counts a blank correct if the answer matches any accepted (normalized)', () => {
    expect(gradeFillBlank(['water', 'O2'], accept)).toEqual({ correct: 2, total: 2 })
    expect(gradeFillBlank([' Water ', 'oxygen'], accept)).toEqual({ correct: 2, total: 2 }) // trim + case
    expect(gradeFillBlank(['水', 'oxygen'], accept)).toEqual({ correct: 2, total: 2 })
  })
  it('partial / wrong / blank answers score proportionally', () => {
    expect(gradeFillBlank(['water', 'wrong'], accept)).toEqual({ correct: 1, total: 2 })
    expect(gradeFillBlank(['', ''], accept)).toEqual({ correct: 0, total: 2 })
    expect(gradeFillBlank(['nope', 'nope'], accept)).toEqual({ correct: 0, total: 2 })
    expect(gradeFillBlank(['water'], accept)).toEqual({ correct: 1, total: 2 }) // missing 2nd answer
  })
  it('total is the number of defined blanks (accept.length)', () => {
    expect(gradeFillBlank([], [['a'], ['b'], ['c']])).toEqual({ correct: 0, total: 3 })
  })

  it('normalizes full-width chars and collapses internal whitespace (audit P2-11)', () => {
    // full-width letters/digits (常见于中文输入法) fold to ASCII via NFKC
    expect(gradeFillBlank(['Ｎｅｗ Ｙｏｒｋ'], [['New York']])).toEqual({ correct: 1, total: 1 })
    expect(gradeFillBlank(['２０２６'], [['2026']])).toEqual({ correct: 1, total: 1 })
    // collapsed internal whitespace: "New  York" (double space) == "New York"
    expect(gradeFillBlank(['New   York'], [['New York']])).toEqual({ correct: 1, total: 1 })
  })
})

describe('isGradableFillBlank — refuse to auto-grade an unusable answer key (audit P0-5)', () => {
  it('accepts a well-formed key: one non-empty accept list per blank', () => {
    expect(isGradableFillBlank({ text: 'a ____ b ____', accept: [['x'], ['y', 'z']] })).toBe(true)
  })
  it('rejects an empty / malformed key (would otherwise score the whole class 0)', () => {
    expect(isGradableFillBlank({ text: 'a ____', accept: [] })).toBe(false) // parse failure / no key
    expect(isGradableFillBlank({ text: '', accept: [] })).toBe(false)
  })
  it('rejects a partially-filled key: any blank with no acceptable answers', () => {
    expect(isGradableFillBlank({ text: 'a ____ b ____', accept: [['x'], []] })).toBe(false)
  })
  it('rejects a key whose blank count disagrees with the text', () => {
    expect(isGradableFillBlank({ text: 'a ____ b ____', accept: [['x']] })).toBe(false) // 2 blanks, 1 answer
    expect(isGradableFillBlank({ text: 'a ____', accept: [['x'], ['y']] })).toBe(false) // 1 blank, 2 answers
  })
})
