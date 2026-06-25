import { describe, it, expect } from 'vitest'
import { estimateGrading, formatTokens, MODEL_RATES } from '../cost'

const sub = (over: Partial<{ hasVideo: boolean; hasAudio: boolean; hasImage: boolean; durationSec: number; recitedLen: number }> = {}) => ({
  hasVideo: false, hasAudio: false, hasImage: false, durationSec: 0, recitedLen: 0, ...over,
})

describe('estimateGrading', () => {
  it('counts video by duration and scales with the number of submissions', () => {
    const one = estimateGrading([sub({ hasVideo: true, durationSec: 60 })], { perceptionModel: 'gemini-3.5-flash', judgeModel: 'gemini-3.5-flash', rubricLen: 0, sentencesLen: 0 })
    // 60s × 260 tok/s = 15600 input; output 400.
    expect(one.inputTokens).toBe(15600)
    expect(one.outputTokens).toBe(400)
    expect(one.usd).toBeGreaterThan(0)

    const three = estimateGrading([sub({ hasVideo: true, durationSec: 60 }), sub({ hasVideo: true, durationSec: 60 }), sub({ hasVideo: true, durationSec: 60 })], { perceptionModel: 'gemini-3.5-flash', judgeModel: 'gemini-3.5-flash', rubricLen: 0, sentencesLen: 0 })
    expect(three.totalTokens).toBe(one.totalTokens * 3)
  })

  it('falls back to a default duration when none was recorded', () => {
    const e = estimateGrading([sub({ hasVideo: true, durationSec: 0 })], { perceptionModel: 'gemini-3.5-flash', judgeModel: 'gemini-3.5-flash', rubricLen: 0, sentencesLen: 0 })
    expect(e.inputTokens).toBe(60 * 260) // defaultVideoSec
  })

  it('prices whisper perception by audio minutes, not tokens', () => {
    const e = estimateGrading([sub({ hasAudio: true, durationSec: 120 })], { perceptionModel: 'whisper-1', judgeModel: 'deepseek-chat', rubricLen: 0, sentencesLen: 0 })
    // 2 min × $0.006 = $0.012 for perception; plus deepseek output (¥) converted.
    expect(e.usd).toBeGreaterThanOrEqual(0.012)
  })

  it('is zero-cost for an empty worklist', () => {
    const e = estimateGrading([], { perceptionModel: 'gemini-3.5-flash', judgeModel: 'gemini-3.5-flash', rubricLen: 100, sentencesLen: 100 })
    expect(e).toMatchObject({ count: 0, totalTokens: 0, usd: 0, cny: 0 })
  })

  it('has a rate for every preset-reachable model', () => {
    for (const id of ['gemini-3.5-flash', 'gemini-2.5-flash', 'qwen-omni-turbo', 'whisper-1', 'deepseek-chat', 'MiniMax-Text-01', 'claude-opus-4-8']) {
      expect(MODEL_RATES[id]).toBeDefined()
    }
  })
})

describe('formatTokens', () => {
  it('compacts large counts (locale-neutral k/M)', () => {
    expect(formatTokens(500)).toBe('500')
    expect(formatTokens(15600)).toBe('16k')
    expect(formatTokens(2_300_000)).toBe('2.3M')
  })
})
