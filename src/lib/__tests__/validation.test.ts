import { describe, it, expect } from 'vitest'
import { validatePassword, validateName, MIN_PASSWORD_LENGTH } from '@/lib/validation'

describe('validatePassword', () => {
  it('rejects passwords shorter than the minimum (returns an i18n key)', () => {
    expect(validatePassword('short')).toBe('err.pwTooShort')
    expect(validatePassword('')).toBe('err.pwTooShort')
  })

  it('accepts passwords at or above the minimum', () => {
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull()
    expect(validatePassword('correct horse battery')).toBeNull()
  })
})

describe('validateName', () => {
  it('treats empty/whitespace as not provided', () => {
    expect(validateName(null)).toEqual({ value: null })
    expect(validateName('   ')).toEqual({ value: null })
  })

  it('trims a provided name', () => {
    expect(validateName('  Ada  ')).toEqual({ value: 'Ada' })
  })

  it('rejects overly long names with an i18n key', () => {
    const result = validateName('x'.repeat(61))
    expect(result.error).toBe('err.nameTooLong')
    expect(result.value).toBeNull()
  })
})
