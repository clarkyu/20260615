import { describe, it, expect } from 'vitest'
import { parseChatJson } from '@/lib/ai/providers/openai-compat'

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
