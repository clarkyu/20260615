import { describe, it, expect } from 'vitest'
import { estimateGrading, formatTokens, MODEL_RATES, costUsd } from '../cost'

const sub = (over: Partial<{ hasVideo: boolean; hasAudio: boolean; hasImage: boolean; durationSec: number; recitedLen: number }> = {}) => ({
  hasVideo: false, hasAudio: false, hasImage: false, durationSec: 0, recitedLen: 0, ...over,
})

describe('estimateGrading', () => {
  it('counts both stages (perception + judge) and scales with the number of submissions', () => {
    const one = estimateGrading([sub({ hasVideo: true, durationSec: 60 })], { perceptionModel: 'gemini-3.5-flash', judgeModel: 'gemini-3.5-flash', rubricLen: 0, sentencesLen: 0 })
    // perception: 60s×260 = 15600 input + 400 output (transcript);
    // judge: 400 input (re-reads the transcript — previously uncounted) + 400 output.
    expect(one.inputTokens).toBe(16000) // 15600 perception + 400 judge input
    expect(one.outputTokens).toBe(800) //  400 perception + 400 judge
    expect(one.usd).toBeGreaterThan(0)

    const three = estimateGrading([sub({ hasVideo: true, durationSec: 60 }), sub({ hasVideo: true, durationSec: 60 }), sub({ hasVideo: true, durationSec: 60 })], { perceptionModel: 'gemini-3.5-flash', judgeModel: 'gemini-3.5-flash', rubricLen: 0, sentencesLen: 0 })
    expect(three.totalTokens).toBe(one.totalTokens * 3)
  })

  it('falls back to a default duration when none was recorded', () => {
    const e = estimateGrading([sub({ hasVideo: true, durationSec: 0 })], { perceptionModel: 'gemini-3.5-flash', judgeModel: 'gemini-3.5-flash', rubricLen: 0, sentencesLen: 0 })
    expect(e.inputTokens).toBe(60 * 260 + 400) // defaultVideoSec (15600) + judge input (400)
  })

  it('prices Gemini audio at its audio rate, not the cheaper text/video input rate', () => {
    expect(MODEL_RATES['gemini-2.5-flash'].audioInputPerM).toBe(1.0)
    // 60s audio = 1500 tok. At the $1.0/M audio rate (not $0.30/M base) plus the other
    // stage costs, the total clears a bound the under-priced version could not.
    const e = estimateGrading([sub({ hasAudio: true, durationSec: 60 })], { perceptionModel: 'gemini-2.5-flash', judgeModel: 'gemini-2.5-flash', rubricLen: 0, sentencesLen: 0 })
    expect(e.usd).toBeGreaterThan(0.0033)
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

describe('costUsd (real usage → USD)', () => {
  it('prices USD models from actual tokens', () => {
    // gemini-3.5-flash: $1.5/M in, $9/M out. 1e6 in + 1e6 out = 1.5 + 9 = 10.5.
    expect(costUsd('gemini-3.5-flash', 1_000_000, 1_000_000)).toBeCloseTo(10.5, 5)
  })

  it('converts CNY-priced models to USD', () => {
    // deepseek-chat: ¥1/M in, ¥2/M out. 1e6+1e6 = ¥3 → /7.2 ≈ $0.4167.
    expect(costUsd('deepseek-chat', 1_000_000, 1_000_000)).toBeCloseTo(3 / 7.2, 4)
  })

  it('is 0 for per-minute (whisper) and unknown models', () => {
    expect(costUsd('whisper-1', 5000, 5000)).toBe(0)
    expect(costUsd('nope', 1000, 1000)).toBe(0)
  })

  it('never goes negative on junk input', () => {
    expect(costUsd('gemini-3.5-flash', -100, -100)).toBe(0)
  })
})

describe('formatTokens', () => {
  it('compacts large counts (locale-neutral k/M)', () => {
    expect(formatTokens(500)).toBe('500')
    expect(formatTokens(15600)).toBe('16k')
    expect(formatTokens(2_300_000)).toBe('2.3M')
  })
})
