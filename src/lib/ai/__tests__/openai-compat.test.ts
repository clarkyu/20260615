import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseChatJson, deepseekJudge } from '@/lib/ai/providers/openai-compat'
import type { JudgeInput } from '@/lib/ai/types'

describe('parseChatJson', () => {
  it('parses content JSON from an OpenAI-style response', () => {
    const data = { choices: [{ message: { content: '{"score": 88, "feedback": "好"}' } }] }
    expect(parseChatJson(data)).toEqual({ score: 88, feedback: '好' })
  })

  it('unwraps fenced JSON', () => {
    const data = { choices: [{ message: { content: '```json\n{"a":1}\n```' } }] }
    expect(parseChatJson(data)).toEqual({ a: 1 })
  })

  it('throws on a MiniMax base_resp error envelope', () => {
    expect(() => parseChatJson({ base_resp: { status_code: 1004, status_msg: 'auth failed' } })).toThrow(/auth failed/)
  })

  it('throws when there is no content', () => {
    expect(() => parseChatJson({ choices: [] })).toThrow(/无有效返回/)
  })
})

describe('compat judge prompt', () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.DEEPSEEK_API_KEY })

  it('asks the model for `confidence` (else auto-approval silently dies — audit P0-3)', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test'
    const reply = JSON.stringify({ score: 8, feedback: '好', confidence: 0.9 })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const input: JudgeInput = {
      perception: { transcript: 'hi', perSentence: [], observations: {} },
      referenceSentences: [{ order: 1, text: 'Hi' }],
      rubric: 'r', maxScore: 10,
    }
    const res = await deepseekJudge.judge(input, 'deepseek-v4-pro')
    expect(res.confidence).toBe(0.9)
    const [, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(opts.body as string).toContain('confidence')
  })
})
