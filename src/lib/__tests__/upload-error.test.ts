import { describe, it, expect } from 'vitest'
import { isStaleAction, uploadErrorText } from '../upload-error'

// A stale client bundle calling a removed server action is a "refresh the page" case, not
// a "check your connection" one. Pin the discrimination so the wrong message can't creep
// back in after a deploy.
const t = (key: string) => key // identity translator — assert on the key chosen

describe('isStaleAction', () => {
  it('flags the named UnrecognizedActionError', () => {
    expect(isStaleAction(Object.assign(new Error('boom'), { name: 'UnrecognizedActionError' }))).toBe(true)
  })

  it('flags any error whose message mentions a server action (case-insensitive)', () => {
    expect(isStaleAction(new Error('Failed to find Server Action xyz'))).toBe(true)
    expect(isStaleAction(new Error('server action not found'))).toBe(true)
  })

  it('does not flag ordinary network/other errors', () => {
    expect(isStaleAction(new Error('NetworkError when fetching'))).toBe(false)
    expect(isStaleAction(new TypeError('Failed to fetch'))).toBe(false)
  })

  it('does not flag non-Error values', () => {
    expect(isStaleAction('server action')).toBe(false)
    expect(isStaleAction(null)).toBe(false)
    expect(isStaleAction(undefined)).toBe(false)
  })
})

describe('uploadErrorText', () => {
  it('tells a stale-action user to reload', () => {
    const e = Object.assign(new Error('x'), { name: 'UnrecognizedActionError' })
    expect(uploadErrorText(e, t)).toBe('rec.staleReload')
  })

  it('otherwise reports an upload failure tagged with the error name', () => {
    expect(uploadErrorText(new TypeError('Failed to fetch'), t)).toBe('rec.uploadFail · TypeError')
  })

  it('falls back to "network" when the thrown value is not an Error', () => {
    expect(uploadErrorText('weird', t)).toBe('rec.uploadFail · network')
  })
})
