import { describe, it, expect } from 'vitest'
import { getSafeRedirectPath } from '@/lib/app-url'

describe('getSafeRedirectPath', () => {
  it('keeps same-site relative paths', () => {
    expect(getSafeRedirectPath('/profile')).toBe('/profile')
    expect(getSafeRedirectPath('/a/b?c=d')).toBe('/a/b?c=d')
  })

  it('rejects absolute and protocol-relative URLs', () => {
    expect(getSafeRedirectPath('https://evil.com')).toBe('/')
    expect(getSafeRedirectPath('//evil.com')).toBe('/')
    expect(getSafeRedirectPath('javascript:alert(1)')).toBe('/')
  })

  it('falls back to / for empty or missing values', () => {
    expect(getSafeRedirectPath(null)).toBe('/')
    expect(getSafeRedirectPath('')).toBe('/')
  })
})
