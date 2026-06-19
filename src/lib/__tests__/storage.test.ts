import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { deleteObject } from '@/lib/storage'

// deleteObject signs a DELETE (aws4fetch + WebCrypto) then calls global fetch; stub fetch
// to drive the status. R2 config must be present so objectUrl() can build the URL.
const R2 = { R2_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'sec', R2_BUCKET: 'bucket' }
beforeEach(() => { for (const [k, v] of Object.entries(R2)) process.env[k] = v })
afterEach(() => { for (const k of Object.keys(R2)) delete process.env[k]; vi.unstubAllGlobals() })

describe('deleteObject', () => {
  it('resolves on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    await expect(deleteObject('submissions/1/v.webm')).resolves.toBeUndefined()
  })

  it('treats an already-gone object (404) as success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    await expect(deleteObject('k')).resolves.toBeUndefined()
  })

  it('throws on a real failure, so the retention sweep counts it and retries', async () => {
    // 403 (not 5xx) so aws4fetch's built-in retry loop doesn't kick in.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })))
    await expect(deleteObject('k')).rejects.toThrow('R2 delete failed: 403')
  })
})
