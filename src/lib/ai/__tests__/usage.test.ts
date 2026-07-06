import { describe, it, expect } from 'vitest'
import { extractUsage } from '../providers/gemini'
import { extractCompatUsage } from '../providers/openai-compat'

// Real per-call token usage was previously discarded; these guard the extraction that
// now carries it into the persisted aiResult (the foundation for spend observability).
describe('token usage extraction', () => {
  it('gemini: reads usageMetadata prompt/candidates token counts', () => {
    expect(extractUsage({ usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300, totalTokenCount: 1500 } }))
      .toEqual({ inputTokens: 1200, outputTokens: 300 })
  })

  it('gemini: folds thinking tokens into outputTokens (billed at the output rate, audit A3)', () => {
    // Gemini 2.5/3 think by default; candidatesTokenCount is only the visible answer, thoughts are separate.
    expect(extractUsage({ usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300, thoughtsTokenCount: 900, totalTokenCount: 2400 } }))
      .toEqual({ inputTokens: 1200, outputTokens: 1200 }) // 300 visible + 900 thoughts
  })

  it('gemini: undefined when usageMetadata is absent', () => {
    expect(extractUsage({ candidates: [] })).toBeUndefined()
    expect(extractUsage(null)).toBeUndefined()
  })

  it('openai-compat: reads usage prompt/completion token counts', () => {
    expect(extractCompatUsage({ usage: { prompt_tokens: 800, completion_tokens: 150, total_tokens: 950 } }))
      .toEqual({ inputTokens: 800, outputTokens: 150 })
  })

  it('openai-compat: undefined when usage is absent', () => {
    expect(extractCompatUsage({ choices: [] })).toBeUndefined()
  })

  it('gemini: coerces missing/NaN counts to 0 rather than emitting NaN', () => {
    expect(extractUsage({ usageMetadata: {} })).toEqual({ inputTokens: 0, outputTokens: 0 })
  })

  it('openai-compat: usage present but missing the token split → undefined, not a fake $0 (audit A7)', () => {
    // MiniMax's chatcompletion_v2 reports only total_tokens; recording {0,0} would book its spend
    // as a real $0. "Cost unknown" (undefined) → domain persists NULL cost.
    expect(extractCompatUsage({ usage: {} })).toBeUndefined()
    expect(extractCompatUsage({ usage: { total_tokens: 950 } })).toBeUndefined()
    // At least one split field present → keep it, default the other to 0.
    expect(extractCompatUsage({ usage: { prompt_tokens: 800 } })).toEqual({ inputTokens: 800, outputTokens: 0 })
  })
})
