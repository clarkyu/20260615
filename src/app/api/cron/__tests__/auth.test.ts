/* eslint-disable @typescript-eslint/no-explicit-any -- minimal request stub */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { POST as drainPOST } from '../drain/route'
import { POST as retentionPOST } from '../retention/route'
import { POST as unifyPOST } from '../../admin/unify-poll-phase/route'

// Minimal request stub — both handlers only read the Authorization header before the gate.
function req(auth?: string): any {
  return { headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? auth ?? null : null) } }
}

beforeEach(() => { delete process.env.CRON_SECRET })
afterEach(() => { delete process.env.CRON_SECRET })

describe.each([
  ['cron/drain', drainPOST],
  ['cron/retention', retentionPOST],
  // 三兄弟里破坏力最大的维护端点(跨班改写学生作答)——守卫必须与前两个同样被钉住。
  ['admin/unify-poll-phase', unifyPOST],
])('POST /api/%s — auth gate', (_name, POST) => {
  it('401 when CRON_SECRET is not configured (even with a bearer)', async () => {
    expect((await POST(req('Bearer anything'))).status).toBe(401)
  })

  it('401 when the bearer is missing or wrong', async () => {
    process.env.CRON_SECRET = 's3cret'
    expect((await POST(req())).status).toBe(401)
    expect((await POST(req('Bearer wrong'))).status).toBe(401)
    expect((await POST(req('s3cret'))).status).toBe(401) // missing "Bearer " prefix
  })
})
