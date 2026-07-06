import { describe, it, expect } from 'vitest'
import { estimateGrading, formatTokens, MODEL_RATES, costUsd, costMicroUsd, perceptionCostUsd, perceptionCostMicroUsd } from '../cost'
import { PRESETS, DEFAULT_PERCEPTION_MODEL, DEFAULT_JUDGE_MODEL } from '../registry'

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
    const e = estimateGrading([sub({ hasAudio: true, durationSec: 120 })], { perceptionModel: 'whisper-1', judgeModel: 'deepseek-v4-flash', rubricLen: 0, sentencesLen: 0 })
    // 2 min × $0.006 = $0.012 for perception; plus a small deepseek output cost.
    expect(e.usd).toBeGreaterThanOrEqual(0.012)
  })

  it('is zero-cost for an empty worklist', () => {
    const e = estimateGrading([], { perceptionModel: 'gemini-3.5-flash', judgeModel: 'gemini-3.5-flash', rubricLen: 100, sentencesLen: 100 })
    expect(e).toMatchObject({ count: 0, totalTokens: 0, usd: 0, cny: 0 })
  })

  it('has a rate for every default + preset-reachable grading model (derived from the registry so it cannot drift — audit P0-2)', () => {
    // Derive the set the app can actually route to, so a new default/preset (e.g. #298's
    // deepseek-v4-pro default judge) can never again ship without a cost rate → silent $0.
    const referenced = new Set<string>([
      DEFAULT_PERCEPTION_MODEL,
      DEFAULT_JUDGE_MODEL,
      ...PRESETS.flatMap((p) => [p.perceptionModel, p.judgeModel]),
    ])
    for (const id of referenced) {
      expect(MODEL_RATES[id], `MODEL_RATES is missing a rate for '${id}' → costUsd would silently return 0`).toBeDefined()
    }
    // explicit: the current default judge must be priced
    expect(MODEL_RATES['deepseek-v4-pro']).toBeDefined()
  })
})

describe('costUsd (real usage → USD)', () => {
  it('prices USD models from actual tokens', () => {
    // gemini-3.5-flash: $1.5/M in, $9/M out. 1e6 in + 1e6 out = 1.5 + 9 = 10.5.
    expect(costUsd('gemini-3.5-flash', 1_000_000, 1_000_000)).toBeCloseTo(10.5, 5)
  })

  it('converts CNY-priced models to USD', () => {
    // MiniMax-Text-01: ¥1/M in, ¥8/M out. 1e6+1e6 = ¥9 → /7.2 ≈ $1.25.
    expect(costUsd('MiniMax-Text-01', 1_000_000, 1_000_000)).toBeCloseTo(9 / 7.2, 4)
  })

  it('is 0 for per-minute (whisper) and unknown models', () => {
    expect(costUsd('whisper-1', 5000, 5000)).toBe(0)
    expect(costUsd('nope', 1000, 1000)).toBe(0)
  })

  it('never goes negative on junk input', () => {
    expect(costUsd('gemini-3.5-flash', -100, -100)).toBe(0)
  })
})

describe('costMicroUsd (real usage → integer µUSD)', () => {
  it('is the same price as costUsd, rounded to an integer micro-USD (1 USD = 1e6 µUSD)', () => {
    // gemini-3.5-flash: 1e6 in + 1e6 out = $10.5 → 10_500_000 µUSD.
    expect(costMicroUsd('gemini-3.5-flash', 1_000_000, 1_000_000)).toBe(10_500_000)
    // MiniMax (CNY): ¥9 → /7.2 = $1.25 → 1_250_000 µUSD.
    expect(costMicroUsd('MiniMax-Text-01', 1_000_000, 1_000_000)).toBe(1_250_000)
  })

  it('always returns an integer (money is stored/summed as integer minor units)', () => {
    const v = costMicroUsd('gemini-2.5-flash', 12_345, 6_789)
    expect(Number.isInteger(v)).toBe(true)
  })

  it('is 0 for per-minute (whisper), unknown models, and junk input', () => {
    expect(costMicroUsd('whisper-1', 5000, 5000)).toBe(0)
    expect(costMicroUsd('nope', 1000, 1000)).toBe(0)
    expect(costMicroUsd('gemini-3.5-flash', -100, -100)).toBe(0)
  })
})

describe('perceptionCostUsd — per-minute (Whisper) priced by audio duration (audit A8)', () => {
  it('prices a per-minute model by audio seconds, not tokens', () => {
    // whisper-1: $0.006/min. 120s = 2 min → $0.012. Tokens are ignored for a per-minute model.
    expect(perceptionCostUsd('whisper-1', 0, 0, 120)).toBeCloseTo(0.012, 6)
    expect(perceptionCostUsd('whisper-1', 9999, 9999, 30)).toBeCloseTo(0.003, 6) // 30s = 0.5 min
    expect(perceptionCostMicroUsd('whisper-1', 0, 0, 120)).toBe(12_000) // integer µUSD
  })
  it('no/zero audio seconds → 0 (not NaN)', () => {
    expect(perceptionCostUsd('whisper-1', 0, 0, undefined)).toBe(0)
    expect(perceptionCostUsd('whisper-1', 0, 0, 0)).toBe(0)
  })
  it('falls through to token pricing for a token-billed model (audioSeconds ignored)', () => {
    expect(perceptionCostUsd('gemini-3.5-flash', 1_000_000, 1_000_000, 120)).toBeCloseTo(10.5, 5)
    expect(perceptionCostUsd('nope', 100, 100, 120)).toBe(0)
  })
})

describe('formatTokens', () => {
  it('compacts large counts (locale-neutral k/M)', () => {
    expect(formatTokens(500)).toBe('500')
    expect(formatTokens(15600)).toBe('16k')
    expect(formatTokens(2_300_000)).toBe('2.3M')
  })
})
