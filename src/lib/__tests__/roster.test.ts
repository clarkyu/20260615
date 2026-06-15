import { describe, it, expect } from 'vitest'
import { extractGrade, extractMajor, shortClassName } from '../roster'

describe('roster field extraction', () => {
  it('pulls the cohort year (年级) from a class name', () => {
    expect(extractGrade('专科2025无人机应用技术2531321区队')).toBe('2025')
    expect(extractGrade('本科2023级软件工程1班')).toBe('2023')
  })

  it('normalises a bare "23级" to a 4-digit year', () => {
    expect(extractGrade('软件23级2班')).toBe('2023')
  })

  it('returns undefined when there is no year', () => {
    expect(extractGrade('无人机区队')).toBeUndefined()
  })

  it('does not mistake a 班号 digit run for a year', () => {
    expect(extractGrade('2531321')).toBeUndefined()
  })

  it('still extracts 班号 and major alongside the year', () => {
    const raw = '专科2025无人机应用技术2531321区队'
    expect(shortClassName(raw)).toBe('2531321')
    expect(extractMajor(raw)).toBe('无人机应用技术')
  })
})
