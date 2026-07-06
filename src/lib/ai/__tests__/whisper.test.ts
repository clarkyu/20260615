import { describe, it, expect, vi } from 'vitest'
import { recitationTokens, alignToReference, whisperPerception } from '../providers/whisper'

describe('recitationTokens', () => {
  it('splits latin into lowercased words and CJK into per-char tokens', () => {
    expect(recitationTokens('The quick, BROWN fox!')).toEqual(['the', 'quick', 'brown', 'fox'])
    expect(recitationTokens('你好世界')).toEqual(['你', '好', '世', '界'])
  })
})

describe('alignToReference', () => {
  it('scores a perfect transcript as 1.0 per sentence', () => {
    const refs = [{ order: 1, text: 'Hello world' }, { order: 2, text: 'Good morning' }]
    const ps = alignToReference(refs, 'hello world good morning')
    expect(ps.map((p) => p.accuracy)).toEqual([1, 1])
    expect(ps.map((p) => p.completeness)).toEqual([1, 1])
  })

  it('scores a partial transcript proportionally', () => {
    const refs = [{ order: 1, text: 'the cat sat down' }]
    const ps = alignToReference(refs, 'the cat')
    expect(ps[0].accuracy).toBe(0.5) // 2 of 4 words matched
  })

  it('credits a repeated word only as many times as it was actually said', () => {
    const refs = [{ order: 1, text: 'go go go go' }]
    expect(alignToReference(refs, 'go go')[0].accuracy).toBe(0.5) // 2 of 4
  })

  it('does not credit the same heard token to two sentences (greedy consume)', () => {
    const refs = [{ order: 1, text: 'apple' }, { order: 2, text: 'apple' }]
    const ps = alignToReference(refs, 'apple') // only one "apple" was said
    expect(ps[0].accuracy).toBe(1)
    expect(ps[1].accuracy).toBe(0)
  })

  it('returns 0 for an empty transcript and handles empty references', () => {
    expect(alignToReference([{ order: 1, text: 'anything' }], '')[0].accuracy).toBe(0)
    expect(alignToReference([{ order: 1, text: '' }], 'hi')[0].accuracy).toBe(0)
  })
})

describe('whisperPerception.perceive — surfaces audio duration for per-minute cost (audit A8)', () => {
  it('reads verbose_json `duration` into audioSeconds', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    // First fetch = pull the recording (blob); second = the transcription POST (json with duration).
    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) =>
      !opts || opts.method !== 'POST'
        ? new Response(new Blob(['audio-bytes']), { status: 200 })
        : new Response(JSON.stringify({ text: 'hello world', duration: 123.4 }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      const res = await whisperPerception.perceive(
        { audioUrl: 'https://signed/audio', referenceSentences: [{ order: 1, text: 'Hello world' }], requireEyesClosed: false },
        'whisper-1',
      )
      expect(res.transcript).toBe('hello world')
      expect(res.audioSeconds).toBe(123.4) // ← the per-minute cost driver
      const post = fetchMock.mock.calls.find(([, o]) => (o as RequestInit)?.method === 'POST')
      expect(post![0] as string).toContain('/audio/transcriptions')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
