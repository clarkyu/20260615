import { describe, it, expect, vi, afterEach } from 'vitest'
import { logError, logWarn, logInfo } from '../log'

// Capture the single JSON line each call emits and parse it back.
function capture(level: 'error' | 'warn' | 'info') {
  const fn = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'
  return vi.spyOn(console, fn).mockImplementation(() => {})
}
afterEach(() => vi.restoreAllMocks())

describe('structured logger', () => {
  it('emits one JSON line with level + scope + msg + ts', () => {
    const spy = capture('error')
    logError('jobs', 'drain failed')
    expect(spy).toHaveBeenCalledTimes(1)
    const event = JSON.parse(spy.mock.calls[0][0] as string)
    expect(event).toMatchObject({ level: 'error', scope: 'jobs', msg: 'drain failed' })
    expect(typeof event.ts).toBe('string')
    expect(Number.isNaN(Date.parse(event.ts))).toBe(false)
  })

  it('keeps an Error name/message/stack (which plain JSON.stringify would drop)', () => {
    const spy = capture('error')
    const err = new TypeError('boom')
    // Sanity: a bare Error stringifies to "{}" — the gotcha this logger exists to fix.
    expect(JSON.stringify(err)).toBe('{}')
    logError('grading', 'failed', err)
    const event = JSON.parse(spy.mock.calls[0][0] as string)
    expect(event.err.name).toBe('TypeError')
    expect(event.err.message).toBe('boom')
    expect(typeof event.err.stack).toBe('string')
  })

  it('degrades a non-Error throw to a string message', () => {
    const spy = capture('error')
    logError('x', 'odd', 'just a string')
    expect(JSON.parse(spy.mock.calls[0][0] as string).err).toEqual({ message: 'just a string' })

    logError('x', 'odd2', { code: 42 })
    expect(JSON.parse(spy.mock.calls[1][0] as string).err.message).toBe('{"code":42}')
  })

  it('attaches safe scalar fields and drops undefined ones', () => {
    const spy = capture('warn')
    logWarn('config', 'optional disabled', undefined, { disabled: 'email,ai', count: 2, gone: undefined })
    const event = JSON.parse(spy.mock.calls[0][0] as string)
    expect(event).toMatchObject({ level: 'warn', disabled: 'email,ai', count: 2 })
    expect('gone' in event).toBe(false)
    expect('err' in event).toBe(false)
  })

  it('logInfo carries fields but never an err', () => {
    const spy = capture('info')
    logInfo('startup', 'ready', { features: 3 })
    const event = JSON.parse(spy.mock.calls[0][0] as string)
    expect(event).toMatchObject({ level: 'info', scope: 'startup', msg: 'ready', features: 3 })
    expect('err' in event).toBe(false)
  })
})
