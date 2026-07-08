import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  stripCodeFence,
  extractJson,
  buildJudgePrompt,
  buildPerceptionPrompt,
  normalizeJudge,
  normalizeAuthorDraft,
  normalizePerSentence,
  buildAuthorPrompt,
  isTransientUploadStatus,
  uploadInitBackoffMs,
  chunkMedia,
  purgeFiles,
  geminiPerception,
} from '@/lib/ai/providers/gemini'
import { withAiKeys } from '@/lib/ai/key-context'
import { PerceptionFileNotReady } from '@/lib/ai/types'

const refs = [
  { order: 1, text: 'The early bird catches the worm.' },
  { order: 2, text: 'Actions speak louder than words.' },
]

describe('stripCodeFence', () => {
  it('unwraps ```json fences and leaves plain text alone', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}')
  })
})

describe('extractJson', () => {
  it('parses the JSON from a normal Gemini response', () => {
    const data = { candidates: [{ content: { parts: [{ text: '{"score":80}' }] } }] }
    expect(extractJson(data)).toEqual({ score: 80 })
  })

  it('throws with the block reason when there is no text', () => {
    expect(() => extractJson({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(/SAFETY/)
    expect(() => extractJson({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] })).toThrow(/MAX_TOKENS/)
  })
})

describe('buildPerceptionPrompt', () => {
  it('includes the reference sentences and the eyes-closed instruction', () => {
    const p = buildPerceptionPrompt({ referenceSentences: refs, requireEyesClosed: true })
    expect(p).toContain('The early bird catches the worm.')
    expect(p).toContain('闭眼')
  })
})

describe('buildJudgePrompt', () => {
  it('includes rubric, max score and the perception result', () => {
    const p = buildJudgePrompt({
      perception: { transcript: 'hello', perSentence: [], observations: {} },
      referenceSentences: refs,
      rubric: '完整度 50；发音 50',
      maxScore: 100,
    })
    expect(p).toContain('完整度 50；发音 50')
    expect(p).toContain('100')
    expect(p).toContain('hello')
  })
})

describe('normalizePerSentence', () => {
  it('clamps accuracy/completeness to [0,1] so a 0–100-scale or junk value cannot hide weak sentences (audit P2-10)', () => {
    const out = normalizePerSentence([
      { order: 1, spokenText: 'Hi', accuracy: 95, completeness: 1.4 }, // model returned 0–100 / >1
      { order: 2, spokenText: 'Yo', accuracy: -0.5, completeness: NaN }, // out of range / junk
    ])
    expect(out[0]).toEqual({ order: 1, spokenText: 'Hi', accuracy: 1, completeness: 1 })
    expect(out[1]).toEqual({ order: 2, spokenText: 'Yo', accuracy: 0, completeness: 0 })
  })

  it('tolerates a non-array and missing fields', () => {
    expect(normalizePerSentence(null)).toEqual([])
    expect(normalizePerSentence([{}])).toEqual([{ order: 0, spokenText: '', accuracy: 0, completeness: 0 }])
  })
})

describe('normalizeJudge', () => {
  it('clamps the score to [0, maxScore] and maps the breakdown array to a record', () => {
    const out = normalizeJudge(
      { score: 130, breakdown: [{ dimension: '完整度', points: 40 }, { dimension: '发音', points: 30 }], feedback: '不错' },
      100,
    )
    expect(out.score).toBe(100)
    expect(out.breakdown).toEqual({ 完整度: 40, 发音: 30 })
    expect(out.feedback).toBe('不错')
  })

  it('throws on a missing/garbled score — never coerces to a fabricated 0 (audit P0-4)', () => {
    expect(() => normalizeJudge({}, 100)).toThrow(/有效分数/)
    expect(() => normalizeJudge({ score: 'excellent', feedback: 'x' }, 100)).toThrow(/有效分数/)
    expect(() => normalizeJudge({ score: null, feedback: 'x' }, 100)).toThrow(/有效分数/)
  })

  it('preserves a legitimate 0 and tolerates other missing fields when the score is valid', () => {
    expect(normalizeJudge({ score: 0, feedback: 'x' }, 100).score).toBe(0)
    const out = normalizeJudge({ score: 50 }, 100)
    expect(out.score).toBe(50)
    expect(out.feedback).toBe('')
    expect(out.breakdown).toEqual({})
  })

  it('parses and clamps confidence to [0,1], undefined when absent', () => {
    expect(normalizeJudge({ score: 80, feedback: 'x', confidence: 0.7 }, 100).confidence).toBe(0.7)
    expect(normalizeJudge({ score: 80, feedback: 'x', confidence: 1.5 }, 100).confidence).toBe(1)
    expect(normalizeJudge({ score: 80, feedback: 'x', confidence: -2 }, 100).confidence).toBe(0)
    expect(normalizeJudge({ score: 80, feedback: 'x' }, 100).confidence).toBeUndefined()
  })
})

describe('normalizeAuthorDraft', () => {
  it('trims fields and drops blank sentences', () => {
    const out = normalizeAuthorDraft({
      title: '  Unit 3 背诵  ',
      category: '背诵作业',
      instructions: '凭记忆背诵。',
      sentences: [' The early bird catches the worm. ', '', 'Actions speak louder than words.'],
    })
    expect(out.title).toBe('Unit 3 背诵')
    expect(out.sentences).toEqual(['The early bird catches the worm.', 'Actions speak louder than words.'])
  })

  it('tolerates missing / wrong-typed fields', () => {
    const out = normalizeAuthorDraft({ sentences: 'not an array' })
    expect(out).toEqual({ title: '', category: '', instructions: '', sentences: [] })
  })
})

describe('buildAuthorPrompt', () => {
  it('mentions the photo only when one is attached, and includes the topic', () => {
    expect(buildAuthorPrompt('Unit 3 重点句', false)).toContain('Unit 3 重点句')
    expect(buildAuthorPrompt('', true)).toContain('图片')
    expect(buildAuthorPrompt('x', false)).not.toContain('所附图片')
  })
})

// The File API upload-init retry policy — the fix for the 221 large videos that were
// stuck on "文件上传初始化失败 429" (rate-limited, previously thrown on first try).
describe('isTransientUploadStatus', () => {
  it('treats 429 and 5xx as transient (retry), other 4xx as terminal (give up)', () => {
    expect(isTransientUploadStatus(429)).toBe(true)
    expect(isTransientUploadStatus(500)).toBe(true)
    expect(isTransientUploadStatus(503)).toBe(true)
    // Terminal — retrying a bad request / auth / not-found only wastes attempts.
    expect(isTransientUploadStatus(400)).toBe(false)
    expect(isTransientUploadStatus(403)).toBe(false)
    expect(isTransientUploadStatus(404)).toBe(false)
  })
})

describe('uploadInitBackoffMs', () => {
  it('backs off exponentially when no Retry-After header is present', () => {
    expect(uploadInitBackoffMs(1, null)).toBe(2000)
    expect(uploadInitBackoffMs(2, null)).toBe(4000)
    expect(uploadInitBackoffMs(3, null)).toBe(8000)
  })

  it('honors a server Retry-After (seconds), capped at 30s', () => {
    expect(uploadInitBackoffMs(1, '5')).toBe(5000)
    expect(uploadInitBackoffMs(1, '120')).toBe(30_000) // capped
    expect(uploadInitBackoffMs(5, null)).toBe(30_000) // exponential also capped
  })

  it('ignores a garbage / non-positive Retry-After and falls back to exponential', () => {
    expect(uploadInitBackoffMs(1, 'soon')).toBe(2000)
    expect(uploadInitBackoffMs(2, '0')).toBe(4000)
    expect(uploadInitBackoffMs(2, '-3')).toBe(4000)
  })
})

// Chunked resumable upload — the fix for the 67 large 期末 videos rejected with 413 on a
// single whole-file POST. chunkMedia re-packs the media into fixed-size pieces; every non-final
// chunk must be exactly `size` (protocol requirement) and reassembly must be byte-exact.
async function collect(gen: AsyncGenerator<Uint8Array>): Promise<Uint8Array[]> {
  const out: Uint8Array[] = []
  for await (const c of gen) out.push(c.slice()) // copy: the streaming path reuses its buffer
  return out
}
function concat(arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.byteLength, 0))
  let o = 0
  for (const a of arrs) { out.set(a, o); o += a.byteLength }
  return out
}
function streamOf(pieces: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < pieces.length) controller.enqueue(pieces[i++])
      else controller.close()
    },
  })
}

describe('chunkMedia', () => {
  const data = Uint8Array.from({ length: 25 }, (_, i) => i) // 0..24

  it('splits a buffered Uint8Array into fixed-size chunks with a smaller last chunk', async () => {
    const chunks = await collect(chunkMedia(data, 10))
    expect(chunks.map((c) => c.byteLength)).toEqual([10, 10, 5])
    expect(concat(chunks)).toEqual(data) // byte-exact reassembly
  })

  it('emits no partial chunk when the size divides the input evenly', async () => {
    const chunks = await collect(chunkMedia(data.subarray(0, 20), 10))
    expect(chunks.map((c) => c.byteLength)).toEqual([10, 10])
  })

  it('re-packs an arbitrarily-chunked stream into fixed-size pieces, byte-exact', async () => {
    // Reader delivers irregular sizes (3, 7, 15) → must be repacked to 10, 10, 5.
    const stream = streamOf([data.subarray(0, 3), data.subarray(3, 10), data.subarray(10, 25)])
    const chunks = await collect(chunkMedia(stream, 10))
    expect(chunks.map((c) => c.byteLength)).toEqual([10, 10, 5])
    expect(concat(chunks)).toEqual(data)
  })

  it('yields nothing for empty input (both buffer and stream)', async () => {
    expect(await collect(chunkMedia(new Uint8Array(0), 10))).toEqual([])
    expect(await collect(chunkMedia(streamOf([]), 10))).toEqual([])
  })

  it('yields a single short chunk when input is smaller than the chunk size', async () => {
    expect((await collect(chunkMedia(Uint8Array.from([1, 2, 3]), 10))).map((c) => [...c])).toEqual([[1, 2, 3]])
  })
})

// purgeFiles — reclaims the Gemini File API 20 GiB/project storage cap that filled when grading
// never deleted uploaded videos (期末考核 20260707, all uploads blocked). Stub fetch: a GET lists a
// page of files, a DELETE removes one. withAiKeys injects the key so apiKey() resolves without env.
function stubGemini(pages: { name: string }[][], deleteOk: () => boolean) {
  let listIdx = 0
  return vi.fn(async (_url: unknown, init?: { method?: string }) => {
    if (init?.method === 'DELETE') return { ok: deleteOk() } as Response
    const page = pages[Math.min(listIdx++, pages.length - 1)] ?? []
    return { ok: true, json: async () => ({ files: page }) } as unknown as Response
  })
}
const page = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ name: `files/${prefix}${i}` }))

describe('purgeFiles', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('deletes files page by page until the list is empty', async () => {
    vi.stubGlobal('fetch', stubGemini([page('a', 100), page('b', 30), []], () => true))
    expect(await withAiKeys({ gemini: 'k' }, () => purgeFiles(9999))).toEqual({ deleted: 130, remaining: false })
  })

  it('stops (never loops forever) when a page cannot be deleted', async () => {
    // list always returns the same page; every delete fails → no progress → must bail.
    vi.stubGlobal('fetch', stubGemini([[{ name: 'files/x' }, { name: 'files/y' }]], () => false))
    expect(await withAiKeys({ gemini: 'k' }, () => purgeFiles(9999))).toEqual({ deleted: 0, remaining: true })
  })

  it('respects the max cap and reports that files remain', async () => {
    vi.stubGlobal('fetch', stubGemini([page('p', 100), page('q', 100), []], () => true))
    expect(await withAiKeys({ gemini: 'k' }, () => purgeFiles(100))).toEqual({ deleted: 100, remaining: true })
  })
})

// Gemini File API handle reuse — a video Gemini takes >60s to ingest used to re-upload (and restart
// the ingest clock) on every retry and dead-letter. perceive now polls a preserved handle instead.
const perceptionResponse = () => ({
  ok: true,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ transcript: 'hi', perSentence: [], observations: {} }) }] } }] }),
})
describe('geminiPerception — File API 句柄复用', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('resume 的文件已 ACTIVE → 复用它,不重传媒体、也不发上传初始化', async () => {
    const calls: { url: string; method: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { method?: string }) => {
      const u = String(url); const method = init?.method ?? 'GET'
      calls.push({ url: u, method })
      if (u.includes(':generateContent')) return perceptionResponse() as unknown as Response
      if (method === 'DELETE') return { ok: true } as Response
      return { ok: true, status: 200, json: async () => ({ name: 'files/u', uri: 'files/u', state: 'ACTIVE', mimeType: 'video/webm' }) } as unknown as Response
    }))

    const res = await withAiKeys({ gemini: 'k' }, () => geminiPerception.perceive(
      { videoUrl: 'https://signed/v', referenceSentences: refs, requireEyesClosed: false, resumeFile: { uri: 'files/u', name: 'files/u' } },
      'gemini-x',
    ))
    expect(res.transcript).toBe('hi')
    expect(calls.some((c) => c.url.includes('/upload/v1beta/files'))).toBe(false) // 没重新上传
    expect(calls.some((c) => c.url.includes('signed/v'))).toBe(false) // 没重新拉媒体
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true) // 评完删文件释放配额
  })

  it('resume 的文件仍 PROCESSING 到点 → 抛 PerceptionFileNotReady 带回句柄(交下次重试续)', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ name: 'files/u', state: 'PROCESSING' }) } as unknown as Response)))
    const p = withAiKeys({ gemini: 'k' }, () => geminiPerception.perceive(
      { videoUrl: 'https://signed/v', referenceSentences: refs, requireEyesClosed: false, resumeFile: { uri: 'files/u', name: 'files/u' } },
      'gemini-x',
    )).then(() => null, (e) => e)
    await vi.advanceTimersByTimeAsync(70_000) // 走完 30×2s 就绪轮询窗口
    const err = await p
    expect(err).toBeInstanceOf(PerceptionFileNotReady)
    expect(err.fileName).toBe('files/u')
  })
})
