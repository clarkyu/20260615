import { describe, it, expect } from 'vitest'
import { dictionaries, LOCALES, DEFAULT_LOCALE, type Locale } from '../i18n'

// Locale parity is a security/correctness invariant: a key present in one language but
// missing in another shows that language's users a raw key string (e.g. "insights.calTitle")
// instead of text. This was previously guarded only by hand (grep on every i18n change) —
// here it's enforced. Interpolation tokens ({n}, {tol}, …) must line up too, or a
// translation silently drops a value.
const ref = DEFAULT_LOCALE
const refKeys = Object.keys(dictionaries[ref]).sort()
const tokensOf = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort()

describe('i18n dictionaries', () => {
  it('every locale has the exact same key set as the reference', () => {
    const refSet = new Set(refKeys)
    for (const loc of LOCALES) {
      if (loc === ref) continue
      const keys = new Set(Object.keys(dictionaries[loc]))
      const missing = refKeys.filter((k) => !keys.has(k))
      const extra = [...keys].filter((k) => !refSet.has(k))
      expect(missing, `${loc} is MISSING keys`).toEqual([])
      expect(extra, `${loc} has EXTRA keys`).toEqual([])
    }
  })

  it('interpolation tokens match the reference for every key', () => {
    for (const k of refKeys) {
      const want = tokensOf(dictionaries[ref][k])
      for (const loc of LOCALES) {
        if (loc === ref) continue
        const v = dictionaries[loc as Locale][k]
        if (v == null || v.trim() === '') continue // intentionally-blank suffixes carry no tokens
        expect(tokensOf(v), `${loc} "${k}" interpolation tokens`).toEqual(want)
      }
    }
  })

  it('the reference locale has no empty values (it is the ultimate fallback)', () => {
    const blanks = refKeys.filter((k) => dictionaries[ref][k].trim() === '')
    expect(blanks, `${ref} has blank values`).toEqual([])
  })
})
