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

  it('coerces missing/NaN counts to 0 rather than emitting NaN', () => {
    expect(extractUsage({ usageMetadata: {} })).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(extractCompatUsage({ usage: {} })).toEqual({ inputTokens: 0, outputTokens: 0 })
  })
})
