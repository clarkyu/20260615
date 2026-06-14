import { describe, it, expect } from 'vitest'
import { normalizeEmail, cn } from '@/lib/utils'

describe('normalizeEmail', () => {
  it('lowercases and trims valid emails', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com')
  })

  it('returns null for empty input', () => {
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail('   ')).toBeNull()
  })

  it('returns null for malformed addresses', () => {
    expect(normalizeEmail('not-an-email')).toBeNull()
    expect(normalizeEmail('a@b')).toBeNull()
    expect(normalizeEmail('a @b.com')).toBeNull()
    expect(normalizeEmail('a@b@c.com')).toBeNull()
  })
})

describe('cn', () => {
  it('merges and dedupes tailwind classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('text-sm', false && 'hidden', 'font-medium')).toBe('text-sm font-medium')
  })
})
