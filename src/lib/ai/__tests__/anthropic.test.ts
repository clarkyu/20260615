import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { claudeJudge } from '../providers/anthropic'
import type { JudgeInput } from '../types'

const input: JudgeInput = {
  perception: { transcript: 'hello', perSentence: [{ order: 1, spokenText: '', completeness: 0.9, accuracy: 0.9 }], observations: {} },
  referenceSentences: [{ order: 1, text: 'Hello' }],
  rubric: '按完整度、准确度评分。',
  maxScore: 10,
}

beforeEach(() => { delete process.env.ANTHROPIC_API_KEY })
afterEach(() => { vi.unstubAllGlobals(); delete process.env.ANTHROPIC_API_KEY })

describe('claudeJudge', () => {
  it('throws an "unavailable" sentinel when no key is configured (graceful degrade)', async () => {
    await expect(claudeJudge.judge(input, 'claude-x')).rejects.toThrow('未配置')
  })

  it('parses the Anthropic content block and normalizes the score', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const judged = JSON.stringify({ score: 8, breakdown: [{ dimension: '完整度', points: 4 }, { dimension: '准确度', points: 4 }], feedback: '不错' })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: judged }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await claudeJudge.judge(input, 'claude-x')
    expect(res.score).toBe(8)
    expect(res.feedback).toBe('不错')
    expect(res.breakdown).toEqual({ 完整度: 4, 准确度: 4 })
    // sanity: it actually called the Messages endpoint with the api-key header
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/v1/messages')
    expect((opts.headers as Record<string, string>)['x-api-key']).toBe('sk-test')
  })
})
