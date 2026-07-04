import { describe, it, expect } from 'vitest'
import { POST } from '../route'

// Minimal Request stub — the handler only calls req.json().
function req(body: unknown, throwOnJson = false): Request {
  return { json: async () => { if (throwOnJson) throw new Error('bad json'); return body } } as unknown as Request
}

describe('POST /api/csp-report', () => {
  it('accepts a report-uri payload and answers 204', async () => {
    const res = await POST(req({ 'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'inline', 'document-uri': 'https://www.hihomework.com/login' } }))
    expect(res.status).toBe(204)
  })

  it('never errors on a malformed or unparseable body (204)', async () => {
    expect((await POST(req(null, true))).status).toBe(204)
    expect((await POST(req('garbage'))).status).toBe(204)
    expect((await POST(req({}))).status).toBe(204)
  })
})
