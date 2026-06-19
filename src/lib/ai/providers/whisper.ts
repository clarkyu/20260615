import type { PerceptionInput, PerceptionProvider, PerceptionResult, PerSentenceResult, ReferenceSentence } from '../types'
import { overrideKey } from '../key-context'
import { unavailable } from '../errors'
import { config } from '@/lib/config'

// OpenAI Whisper is a transcription model (audio → text) — no vision, no scoring. So
// this provider transcribes the recording, then scores each reference sentence by text
// alignment. Audio-only: no eyes-closed / face anti-cheat observations. Pair it with a
// text judge model for the final grade.

// Tokenize for alignment: each CJK char is its own token, each latin/number run is a
// token; lowercased, punctuation/whitespace dropped. Handles both English and Chinese.
export function recitationTokens(s: string): string[] {
  const out: string[] = []
  for (const m of s.toLowerCase().matchAll(/[一-龥]|[a-z0-9']+/g)) out.push(m[0])
  return out
}

// Score each reference sentence against the transcript by greedily consuming matched
// tokens (a word Whisper heard once isn't credited to two sentences). With only ASR text,
// "did you say the words" is the single signal, so accuracy = completeness = matched/expected.
// Pure + deterministic → unit-testable.
export function alignToReference(referenceSentences: ReferenceSentence[], transcript: string): PerSentenceResult[] {
  const pool = new Map<string, number>()
  for (const tk of recitationTokens(transcript)) pool.set(tk, (pool.get(tk) ?? 0) + 1)
  return referenceSentences.map((r) => {
    const toks = recitationTokens(r.text)
    let matched = 0
    for (const tk of toks) {
      const c = pool.get(tk) ?? 0
      if (c > 0) { matched++; pool.set(tk, c - 1) }
    }
    const ratio = toks.length ? matched / toks.length : 0
    return { order: r.order, spokenText: '', completeness: ratio, accuracy: ratio }
  })
}

function apiKey(): string {
  // The grading teacher's own key (BYOK) wins; otherwise the platform key. Whisper shares
  // the OpenAI credential.
  const key = overrideKey('whisper') ?? config.openaiKey()
  if (!key) throw unavailable('OPENAI_API_KEY 未配置')
  return key
}

export const whisperPerception: PerceptionProvider = {
  async perceive(input: PerceptionInput, modelId: string): Promise<PerceptionResult> {
    const media = input.audioUrl || input.videoUrl
    if (!media) throw new Error('Whisper 需要音频（请确认已上传录音）')
    const base = config.openaiBaseUrl().replace(/\/$/, '')

    // Pull the recording from R2 (presigned URL) and hand the bytes to Whisper.
    const mediaRes = await fetch(media, { signal: AbortSignal.timeout(120_000) })
    if (!mediaRes.ok) throw new Error(`读取录音失败: ${mediaRes.status}`)
    const blob = await mediaRes.blob()

    const form = new FormData()
    form.append('file', blob, 'recording.webm')
    form.append('model', modelId)
    form.append('response_format', 'json')
    const res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}` },
      body: form,
      signal: AbortSignal.timeout(180_000),
    })
    if (!res.ok) throw new Error(`whisper ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = (await res.json()) as { text?: string }
    const transcript = (data.text ?? '').trim()

    return {
      transcript,
      perSentence: alignToReference(input.referenceSentences, transcript),
      observations: {
        readingSuspected: false,
        continuousTake: true,
        notes: 'Whisper 仅转写音频，无画面/防作弊观测；逐句分基于转写文本匹配。',
      },
      raw: data,
    }
  },
}
