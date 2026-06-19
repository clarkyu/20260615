import { describe, it, expect } from 'vitest'
import { localDayWindowUtc, parseTzOffset, formatLocalDay } from '@/lib/time'

describe('localDayWindowUtc', () => {
  it('UTC+8 (tzo=-480): a UTC instant near local midnight maps to the right local day', () => {
    // 2026-06-17T17:00Z = 2026-06-18 01:00 local (UTC+8) → local day is the 18th.
    const { start, end } = localDayWindowUtc(new Date('2026-06-17T17:00:00Z'), -480)
    expect(start.toISOString()).toBe('2026-06-17T16:00:00.000Z') // 2026-06-18 00:00 local
    expect(end.toISOString()).toBe('2026-06-18T16:00:00.000Z') // 2026-06-19 00:00 local
  })
  it('UTC (tzo=0): the window is the plain UTC day', () => {
    const { start, end } = localDayWindowUtc(new Date('2026-06-18T09:30:00Z'), 0)
    expect(start.toISOString()).toBe('2026-06-18T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-06-19T00:00:00.000Z')
  })
  it('a due-at inside the window is "today", one just outside is not', () => {
    const { start, end } = localDayWindowUtc(new Date('2026-06-17T20:00:00Z'), -480) // local 06-18 04:00
    const dueToday = new Date('2026-06-18T10:00:00Z') // local 06-18 18:00 → today
    const dueTomorrow = new Date('2026-06-18T17:00:00Z') // local 06-19 01:00 → not today
    expect(dueToday >= start && dueToday < end).toBe(true)
    expect(dueTomorrow >= start && dueTomorrow < end).toBe(false)
  })
})

describe('parseTzOffset', () => {
  it('parses a numeric offset, defaults to 0 on junk', () => {
    expect(parseTzOffset('-480')).toBe(-480)
    expect(parseTzOffset('0')).toBe(0)
    expect(parseTzOffset(undefined)).toBe(0)
    expect(parseTzOffset('abc')).toBe(0)
    expect(parseTzOffset('99999')).toBe(0) // out of sane range
  })
})

describe('formatLocalDay', () => {
  it('renders the same calendar day the user sees, given their tz offset', () => {
    // 2026-06-19T16:30Z is already the 20th in UTC+8 (tzo=-480) — server (UTC) and the
    // browser must BOTH say 2026-06-20, otherwise the date flashes on hydration.
    expect(formatLocalDay('2026-06-19T16:30:00Z', -480)).toBe('2026-06-20')
    expect(formatLocalDay('2026-06-19T16:30:00Z', 0)).toBe('2026-06-19') // plain UTC day
    // UTC-5 (tzo=300): an early-UTC instant is still the previous local day.
    expect(formatLocalDay('2026-06-19T02:00:00Z', 300)).toBe('2026-06-18')
  })
  it('returns empty string for an unparseable instant', () => {
    expect(formatLocalDay('not-a-date', -480)).toBe('')
  })
})
