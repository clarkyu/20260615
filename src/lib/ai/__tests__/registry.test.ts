import { describe, it, expect } from 'vitest'
import { getModel, modelsForCapability } from '../registry'

describe('getModel + legacy aliases', () => {
  it('resolves the live DeepSeek V4 Flash id', () => {
    const m = getModel('deepseek-v4-flash')
    expect(m).toBeDefined()
    expect(m?.provider).toBe('deepseek')
    expect(m?.capabilities).toContain('judge')
  })

  it('maps retired deepseek ids to their live successor (DB pins keep working post-deprecation)', () => {
    // deepseek-chat / deepseek-reasoner retire 2026-07-24; a stored pin must still grade.
    expect(getModel('deepseek-chat')?.id).toBe('deepseek-v4-flash')
    expect(getModel('deepseek-reasoner')?.id).toBe('deepseek-v4-flash')
  })

  it('returns undefined for a genuinely unknown id', () => {
    expect(getModel('nope-9000')).toBeUndefined()
  })

  it('no longer lists the retired id as a selectable judge model', () => {
    const judgeIds = modelsForCapability('judge').map((m) => m.id)
    expect(judgeIds).toContain('deepseek-v4-flash')
    expect(judgeIds).not.toContain('deepseek-chat')
  })
})
