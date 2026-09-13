import { describe, it, expect } from 'vitest'
import { createAiCaller, AiError, getAiConfig, type AiConfig } from '@/lib/ai/client'
import { rateLimit, resetRateLimits } from '@/lib/rate-limit'

// AI 调用层(SPEC §5.3:温度 0 + JSON 模式 + 超时)与限速(§9.5):用假 fetch,不打真接口。

const cfg: AiConfig = { baseUrl: 'https://ai.example/v1', apiKey: 'k', gradingModel: 'g', authoringModel: 'a', timeoutMs: 50 }
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

describe('createAiCaller', () => {
  it('请求:POST {base}/chat/completions、Bearer 头、温度 0、json_object、system+user 两条消息', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const call = createAiCaller(cfg, async (url, init) => {
      seen = { url: String(url), init: init! }
      return ok({ model: 'g-2', choices: [{ message: { content: '{"score":1}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
    })
    const out = await call({ model: 'g', system: 'S', user: 'U' })
    expect(seen!.url).toBe('https://ai.example/v1/chat/completions')
    expect((seen!.init.headers as Record<string, string>).authorization).toBe('Bearer k')
    const body = JSON.parse(String(seen!.init.body)) as Record<string, unknown>
    expect(body).toMatchObject({ model: 'g', temperature: 0, max_tokens: 800, response_format: { type: 'json_object' } })
    expect(body.messages).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'U' },
    ])
    expect(out).toMatchObject({ text: '{"score":1}', model: 'g-2', usage: { promptTokens: 10, completionTokens: 5 } })
    expect(out.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('超时 → AiError timeout', async () => {
    const call = createAiCaller(cfg, (_url, init) => new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
    await expect(call({ model: 'g', system: 'S', user: 'U' })).rejects.toMatchObject({ name: 'AiError', kind: 'timeout' })
  })

  it('非 2xx → AiError http 带状态码;网络异常 → network', async () => {
    const call503 = createAiCaller(cfg, async () => new Response('', { status: 503 }))
    await expect(call503({ model: 'g', system: 'S', user: 'U' })).rejects.toMatchObject({ kind: 'http', status: 503 })
    const callNet = createAiCaller(cfg, async () => {
      throw new TypeError('fetch failed')
    })
    await expect(callNet({ model: 'g', system: 'S', user: 'U' })).rejects.toMatchObject({ kind: 'network' })
  })

  it('响应体非 JSON / 无 content → bad_response;usage 缺省为 0', async () => {
    const bad = createAiCaller(cfg, async () => new Response('<html>', { status: 200 }))
    await expect(bad({ model: 'g', system: 'S', user: 'U' })).rejects.toMatchObject({ kind: 'bad_response' })
    const empty = createAiCaller(cfg, async () => ok({ choices: [] }))
    await expect(empty({ model: 'g', system: 'S', user: 'U' })).rejects.toBeInstanceOf(AiError)
    const noUsage = createAiCaller(cfg, async () => ok({ choices: [{ message: { content: '{}' } }] }))
    expect((await noUsage({ model: 'g', system: 'S', user: 'U' })).usage).toEqual({ promptTokens: 0, completionTokens: 0 })
  })
})

describe('getAiConfig 细节', () => {
  it('AI_TIMEOUT_MS 非法或 0 → 30000;AI_MODEL_AUTHORING 生效', () => {
    const base = { AI_BASE_URL: 'https://x/v1', AI_API_KEY: 'k', AI_MODEL_GRADING: 'm' }
    expect(getAiConfig({ ...base, AI_TIMEOUT_MS: 'abc' })?.timeoutMs).toBe(30_000)
    expect(getAiConfig({ ...base, AI_TIMEOUT_MS: '0' })?.timeoutMs).toBe(30_000)
    expect(getAiConfig({ ...base, AI_TIMEOUT_MS: '5000', AI_MODEL_AUTHORING: 'm2' })).toMatchObject({ timeoutMs: 5000, authoringModel: 'm2' })
  })
})

describe('rateLimit(滑动窗口)', () => {
  it('窗口内超过 limit 次拒绝;窗口过后放行;不同 key 互不影响', () => {
    resetRateLimits()
    const t0 = 1_000_000
    expect(rateLimit('u1', 2, 1000, t0)).toBe(true)
    expect(rateLimit('u1', 2, 1000, t0 + 10)).toBe(true)
    expect(rateLimit('u1', 2, 1000, t0 + 20)).toBe(false)
    expect(rateLimit('u2', 2, 1000, t0 + 20)).toBe(true)
    expect(rateLimit('u1', 2, 1000, t0 + 1001)).toBe(true)
  })
})
