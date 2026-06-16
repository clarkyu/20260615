import { describe, it, expect } from 'vitest'
import { unavailable, isUnavailable } from '../errors'

describe('AI-unavailable sentinel contract', () => {
  it('detects the exact messages the providers actually throw', () => {
    // If any of these stops matching, AI grading would mark a not-configured
    // model FAILED instead of leaving it for the teacher — pin them here.
    expect(isUnavailable('GEMINI_API_KEY 未配置')).toBe(true)
    expect(isUnavailable('QWEN_API_KEY 未配置')).toBe(true)
    expect(isUnavailable('感知 provider 未实现')).toBe(true)
    expect(isUnavailable('感知 provider 未实现: openai')).toBe(true)
    expect(isUnavailable('评分 provider 未实现: deepseek')).toBe(true)
  })

  it('every error built by unavailable() is detected', () => {
    expect(isUnavailable(unavailable('FOO_API_KEY 未配置').message)).toBe(true)
  })

  it('does NOT match real upstream failures that must surface', () => {
    expect(isUnavailable('Incorrect API key provided')).toBe(false)
    expect(isUnavailable('fetch failed')).toBe(false)
    expect(isUnavailable('429 Too Many Requests')).toBe(false)
  })
})
