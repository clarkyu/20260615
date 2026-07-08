import type {
  AuthorDraft,
  AuthorInput,
  AuthorProvider,
  JudgeInput,
  JudgeResult,
  PerceptionInput,
  PerceptionProvider,
  PerceptionResult,
  PerSentenceResult,
  JudgeProvider,
  ReferenceSentence,
  TextJudgeInput,
  TokenUsage,
} from '../types'
import { PerceptionFileNotReady } from '../types'

// Re-exported so long-standing imports of these authoring types from this module
// keep working; the canonical definitions now live in ../types.
export type { AuthorDraft, AuthorInput } from '../types'
import { config } from '@/lib/config'
import { overrideKey } from '../key-context'
import { unavailable } from '../errors'
import { UPSTREAM_TIMEOUT_MS, POLL_TIMEOUT_MS } from '../net'

// Real Gemini adapter (REST API via fetch — Workers-compatible, no SDK).
// Perception (multimodal: video/audio) and judging (text) both go to Gemini
// with structured JSON output. Configure GEMINI_API_KEY (+ optional
// GEMINI_BASE_URL to route through a proxy).

function baseUrl(): string {
  return config.geminiBaseUrl().replace(/\/$/, '')
}

function apiKey(): string {
  // The grading teacher's own key (BYOK) wins; otherwise the platform key.
  const key = overrideKey('gemini') ?? config.geminiKey()
  if (!key) throw unavailable('GEMINI_API_KEY 未配置')
  return key
}

// ── Gemini Schema (OpenAPI subset; types are UPPERCASE in the REST proto) ─────
const PERCEPTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING' },
    perSentence: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          order: { type: 'INTEGER' },
          spokenText: { type: 'STRING' },
          completeness: { type: 'NUMBER' },
          accuracy: { type: 'NUMBER' },
        },
        required: ['order', 'spokenText', 'completeness', 'accuracy'],
      },
    },
    pronunciationImpression: { type: 'STRING' },
    observations: {
      type: 'OBJECT',
      properties: {
        eyesClosed: { type: 'BOOLEAN' },
        readingSuspected: { type: 'BOOLEAN' },
        facePresent: { type: 'BOOLEAN' },
        continuousTake: { type: 'BOOLEAN' },
        notes: { type: 'STRING' },
      },
    },
  },
  required: ['transcript', 'perSentence', 'observations'],
} as const

const JUDGE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    score: { type: 'NUMBER' },
    breakdown: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { dimension: { type: 'STRING' }, points: { type: 'NUMBER' } },
        required: ['dimension', 'points'],
      },
    },
    feedback: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
  },
  required: ['score', 'feedback'],
} as const

type Part =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } }

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────

export function stripCodeFence(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return (match ? match[1] : text).trim()
}

// Pulls the JSON object out of a Gemini generateContent response, or throws a
// descriptive error (blocked, empty, malformed).
export function extractJson(data: unknown): unknown {
  const d = data as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
    promptFeedback?: { blockReason?: string }
  }
  const parts = d?.candidates?.[0]?.content?.parts ?? []
  const text = parts.map((p) => p.text ?? '').join('').trim()
  if (!text) {
    const reason = d?.promptFeedback?.blockReason || d?.candidates?.[0]?.finishReason
    throw new Error(`Gemini 无有效返回${reason ? `（${reason}）` : ''}`)
  }
  return JSON.parse(stripCodeFence(text))
}

// Real token usage from a generateContent response (undefined when absent). Gemini 2.5/3 models
// "think" by default; their reasoning tokens are billed at the OUTPUT rate but reported separately
// as `thoughtsTokenCount` (`candidatesTokenCount` is only the visible answer). Fold thoughts into
// outputTokens, else cost is systematically under-reported on the default perception model (which
// runs on every speech submission and shadow take).
export function extractUsage(data: unknown): TokenUsage | undefined {
  const u = (data as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } })?.usageMetadata
  if (!u) return undefined
  return {
    inputTokens: Number(u.promptTokenCount) || 0,
    outputTokens: (Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0),
  }
}

function referenceBlock(sentences: ReferenceSentence[]): string {
  return sentences.map((s) => `${s.order}. ${s.text}`).join('\n')
}

export function buildPerceptionPrompt(input: PerceptionInput): string {
  return [
    '你是英语背诵作业的评阅助手。学生应当凭记忆背诵下列句子' +
      (input.requireEyesClosed ? '（要求闭眼，不能照读）' : '') +
      '。请观看/聆听这段视频，逐句比对参考句子，并观察是否闭眼、是否照读、是否一镜到底、画面里是否有人。',
    '',
    '参考句子：',
    referenceBlock(input.referenceSentences),
    '',
    '严格按给定 JSON schema 返回：transcript 为听写到的全文；perSentence 中 completeness/accuracy 取 0~1；observations 给出布尔判断与简短中文 notes；pronunciationImpression 用一句中文概述发音与流利度。',
  ].join('\n')
}

export function buildJudgePrompt(input: JudgeInput): string {
  return [
    '你是英语背诵作业的阅卷老师。请依据【评分标准】，结合【感知结果】给这次背诵打分并写详细中文评语。',
    '',
    `满分：${input.maxScore} 分。score 必须在 0~${input.maxScore} 之间。`,
    'breakdown 给出各维度得分（dimension+points）。feedback 用中文，指出做得好与需改进之处，可引用具体句子。',
    'confidence 取 0~1，表示你对本次评分的把握程度（音频清晰、与参考高度吻合时给高分；含糊、缺失、异常时给低分）。',
    '',
    ...(input.theme ? [`学生在选题环节选定的作业主题：${input.theme}（请据此主题批阅，评语要有针对性）`, ''] : []),
    '参考句子：',
    referenceBlock(input.referenceSentences),
    '',
    ...(input.recitedText
      ? ['第一步·学生默写的文本（书面背诵）：', input.recitedText, '']
      : []),
    '第二步·视频感知结果（转写/逐句/发音/作弊观察）：',
    JSON.stringify(input.perception, null, 2),
    '',
    '请综合书面默写与口头背诵两步给分。评分标准：',
    input.rubric,
  ].join('\n')
}

// The writing (text-only) judge prompt: grade a student's written answer against the
// rubric, no perception/speech step. Reuses JUDGE_SCHEMA + normalizeJudge (same output).
export function buildWritingJudgePrompt(input: TextJudgeInput): string {
  return [
    '你是英语写作阅卷老师。请依据【评分标准】给学生这篇书面作答打分并写详细中文评语。',
    '',
    `满分：${input.maxScore} 分。score 必须在 0~${input.maxScore} 之间。`,
    'breakdown 给出各维度得分（dimension+points）。feedback 用中文，指出优点与需改进之处，可引用学生原文的具体词句并给出改写建议。',
    'confidence 取 0~1，表示你对本次评分的把握程度（作答完整、切题时给高分；空泛、离题、过短或疑似作弊时给低分）。',
    '',
    ...(input.theme ? [`学生在选题环节选定的作业主题：${input.theme}（请据此主题批阅是否切题）`, ''] : []),
    ...(input.instructions ? ['写作要求 / 题目：', input.instructions, ''] : []),
    ...(input.referenceSentences && input.referenceSentences.length
      ? ['参考 / 范文（默写题请据此比对）：', referenceBlock(input.referenceSentences), '']
      : []),
    '学生作答：',
    input.studentText,
    '',
    '评分标准：',
    input.rubric,
  ].join('\n')
}

export function normalizeJudge(raw: unknown, maxScore: number): JudgeResult {
  const r = raw as { score?: unknown; breakdown?: { dimension?: string; points?: number }[]; feedback?: unknown; confidence?: unknown }
  // A missing / non-numeric score must NOT be coerced to a real 0 — that persists a
  // fabricated grade (auto-finalized on free-practice phases, invisible to the teacher).
  // Throw so the submission goes FAILED/retry instead. A legitimate 0 is finite → passes.
  const n = Number(r?.score)
  if (r?.score == null || !Number.isFinite(n)) throw new Error('judge 未返回有效分数')
  const score = Math.max(0, Math.min(maxScore, Math.round(n)))
  const breakdown: Record<string, number> = {}
  if (Array.isArray(r?.breakdown)) {
    for (const b of r.breakdown) {
      if (b && typeof b.dimension === 'string') breakdown[b.dimension] = Number(b.points) || 0
    }
  }
  const confRaw = Number(r?.confidence)
  const confidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : undefined
  return { score, breakdown, feedback: typeof r?.feedback === 'string' ? r.feedback : '', confidence, raw }
}

// ── Network ───────────────────────────────────────────────────────────────────

// Descriptive local names for the shared upstream timeouts (values single-sourced in ../net):
// a stalled upstream must not pin a Worker isolate until the platform wall-clock limit.
const GEN_TIMEOUT_MS = UPSTREAM_TIMEOUT_MS
const NET_TIMEOUT_MS = POLL_TIMEOUT_MS

async function generate(model: string, parts: Part[], schema: unknown): Promise<{ data: unknown; usage?: TokenUsage }> {
  // Auth via the x-goog-api-key header, not a ?key= query param — a query string leaks
  // into access/proxy logs and any error that echoes the URL; a header does not.
  const res = await fetch(`${baseUrl()}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(GEN_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const raw = await res.json()
  return { data: extractJson(raw), usage: extractUsage(raw) }
}

// 内联(base64)与 File API 流式上传的分界。压到 4MB(期末考核复盘):内联要把整段
// 视频读进内存再 base64——一份十几 MB 的视频瞬时吃掉几十 MB,一批连评几份就顶穿
// Worker 128MB 内存,isolate 被杀、请求 502、提交被丢在 PROCESSING。超过阈值走
// uploadFile 的流式路径(不缓冲、零 base64),内存平坦;短音频/小视频仍内联(省一次
// 上传往返)。
const INLINE_MAX_BYTES = 4 * 1024 * 1024

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

// The File API 上传初始化 is rate-limited INDEPENDENTLY of generateContent, on its own
// (lower) quota. During a burst (期末考核) its 429 was the single biggest blocker: 221 大
// 视频全卡在这一步、每次一抛就整份重跑,而这类限流往往几秒就缓过来。So retry the init in
// place on transient failures. These two policy helpers are pure + exported for unit tests.

// 429（限流）与 5xx（上游抖动）是瞬时的 → 重试;其它（400/403/404…）是终态 → 立即抛。
export function isTransientUploadStatus(status: number): boolean {
  return status === 429 || status >= 500
}

// 退避时长:优先尊重服务端 Retry-After(秒),否则指数退避;都封顶 30s——更久的持久限流
// 交给耐久队列的分钟级退避,不在一次评阅里死等。attempt 从 1 起。
const UPLOAD_INIT_MAX_TRIES = 4
export function uploadInitBackoffMs(attempt: number, retryAfterHeader: string | null): number {
  const ra = Number(retryAfterHeader)
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 30_000)
  return Math.min(1000 * 2 ** attempt, 30_000) // attempt 1→2s, 2→4s, 3→8s
}

// Chunk size for the resumable upload. Every non-final chunk must be a multiple of 256KB (the
// resumable-upload protocol requires it); 8MB is 32×256KB and keeps peak memory to ~one chunk.
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

// Re-pack the media into fixed-size byte chunks (the last may be smaller), from either an
// already-buffered Uint8Array or a streaming ReadableStream. Repacking guarantees every non-final
// chunk is exactly `size` bytes (the protocol's requirement). The streaming path buffers only one
// chunk at a time, so Worker memory stays flat regardless of file size. Exported for unit tests.
export async function* chunkMedia(body: BodyInit, size: number): AsyncGenerator<Uint8Array> {
  if (body instanceof Uint8Array) {
    for (let off = 0; off < body.byteLength; off += size) {
      yield body.subarray(off, Math.min(off + size, body.byteLength))
    }
    return
  }
  const reader = (body as ReadableStream<Uint8Array>).getReader()
  let buf = new Uint8Array(size)
  let filled = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    let v = value
    while (v.byteLength > 0) {
      const take = Math.min(size - filled, v.byteLength)
      buf.set(v.subarray(0, take), filled)
      filled += take
      v = v.subarray(take)
      if (filled === size) {
        yield buf
        buf = new Uint8Array(size)
        filled = 0
      }
    }
  }
  if (filled > 0) yield buf.subarray(0, filled)
}

// POST one chunk to the resumable upload URL. 'finalize' rides the last chunk and returns the
// file JSON. A non-2xx here surfaces as an error the durable queue retries (whole-upload restart).
async function uploadChunk(uploadUrl: string, chunk: Uint8Array, offset: number, finalize: boolean): Promise<Response> {
  const resp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Offset': String(offset),
      'X-Goog-Upload-Command': finalize ? 'upload, finalize' : 'upload',
    },
    // A typed-array view is a valid fetch body; cast past the Workers BodyInit generic
    // (Uint8Array<ArrayBufferLike>) the same way the buffered upload path always has.
    body: chunk as BodyInit,
    signal: AbortSignal.timeout(GEN_TIMEOUT_MS),
  })
  if (!resp.ok) throw new Error(`Gemini 文件上传失败 ${resp.status}`)
  return resp
}

type FileRecord = { uri?: string; name: string; state?: string; mimeType?: string }

// Poll an already-uploaded File API file until it's ACTIVE (usable by generateContent), FAILED, or
// gone (404 — expired/deleted → caller re-uploads). Budget 30×2s = 60s: a fresh upload of a large
// video needs this long to be ingested; a RESUMED file (uploaded by a prior attempt minutes ago) is
// almost always ACTIVE on the first poll and returns immediately. Transient poll errors keep waiting.
async function pollUntilReady(name: string, maxIters = 30): Promise<FileRecord> {
  const key = apiKey()
  let file: FileRecord = { name }
  for (let i = 0; i <= maxIters; i++) {
    try {
      const poll = await fetch(`${baseUrl()}/v1beta/${name}`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(NET_TIMEOUT_MS) })
      if (poll.status === 404) return { name, state: 'GONE' }
      if (poll.ok) {
        file = (await poll.json()) as FileRecord
        if (file.state === 'ACTIVE' || file.state === 'FAILED') break
      }
    } catch { /* transient poll error/timeout — keep waiting */ }
    if (i < maxIters) await sleep(2000)
  }
  return { uri: file.uri, name: file.name ?? name, state: file.state, mimeType: file.mimeType }
}

// Uploads media to the Gemini File API (resumable). Returns the file record straight after the final
// chunk — it may still be PROCESSING; the caller (mediaPart) waits for ACTIVE via pollUntilReady, so
// the readiness wait can be shared with the retry-resume path. Throws only on real upload failures.
async function uploadFile(body: BodyInit, contentLength: number, mimeType: string): Promise<FileRecord> {
  const key = apiKey()
  // Retry ONLY the init step: its body is a fresh JSON string (re-sendable). The upload
  // step below streams a one-shot body and must not be retried here.
  let start: Response | undefined
  for (let attempt = 1; attempt <= UPLOAD_INIT_MAX_TRIES; attempt++) {
    start = await fetch(`${baseUrl()}/upload/v1beta/files`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': key,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(contentLength),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: 'recitation' } }),
      signal: AbortSignal.timeout(NET_TIMEOUT_MS),
    })
    if (start.ok) break
    // Terminal error, or attempts exhausted → surface it (durable queue takes over).
    if (attempt >= UPLOAD_INIT_MAX_TRIES || !isTransientUploadStatus(start.status)) {
      throw new Error(`Gemini 文件上传初始化失败 ${start.status}`)
    }
    await sleep(uploadInitBackoffMs(attempt, start.headers.get('retry-after')))
  }
  if (!start) throw new Error('Gemini 文件上传初始化失败')
  const uploadUrl = start.headers.get('X-Goog-Upload-URL')
  if (!uploadUrl) throw new Error('Gemini 未返回上传地址')

  // Upload in fixed-size chunks rather than one whole-file POST. A single-shot upload of a large
  // video is rejected with 413 (期末考核:67 份闭眼背诵卡在这一步——整段视频超过单请求体积上限);
  // chunked resumable upload sidesteps that per-request cap while keeping memory flat. 'finalize'
  // must ride the LAST chunk, so we send each chunk one behind — the pending chunk becomes the
  // final one once the stream is exhausted.
  let offset = 0
  let pending: Uint8Array | null = null
  for await (const chunk of chunkMedia(body, UPLOAD_CHUNK_BYTES)) {
    if (pending) {
      await uploadChunk(uploadUrl, pending, offset, false)
      offset += pending.byteLength
    }
    pending = chunk
  }
  if (!pending) throw new Error('Gemini 文件上传失败（空文件）')
  const up = await uploadChunk(uploadUrl, pending, offset, true)
  const file = (await up.json() as { file?: FileRecord }).file
  if (!file?.name) throw new Error('Gemini 文件上传失败（空文件）')
  return { uri: file.uri, name: file.name, state: file.state, mimeType: file.mimeType }
}

// Delete a File API file. The File API has a 20 GiB/project storage cap and uploaded files linger
// ~48h; grading never deleted them, so a heavy day piled up to the cap and then EVERY new upload
// was rejected — a grading-wide outage (期末考核 20260707). perceive() now deletes the file the
// instant generateContent is done with it, so storage never accumulates. Best-effort: the grade
// already succeeded, so a failed delete just leaves the file to expire on its own — never throw.
export async function deleteFile(name: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}/v1beta/${name}`, {
      method: 'DELETE',
      headers: { 'x-goog-api-key': apiKey() },
      signal: AbortSignal.timeout(NET_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

// One-off maintenance: reclaim File API storage by deleting the platform project's lingering files
// (the per-grade delete above is the permanent fix; this clears the historical pile-up). Repeatedly
// lists page 1 and deletes it — deletions shrink the set, so page 1 keeps yielding fresh files until
// empty. Bounded by `max` (one Worker request stays well within limits) and stops if a page can't be
// deleted, so it can never spin forever. Returns whether files remain so the caller repeats until 0.
export async function purgeFiles(max: number): Promise<{ deleted: number; remaining: boolean }> {
  const key = apiKey()
  let deleted = 0
  for (;;) {
    const res = await fetch(`${baseUrl()}/v1beta/files?pageSize=100`, {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(NET_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Gemini files.list 失败 ${res.status}`)
    const body = (await res.json()) as { files?: { name?: string }[] }
    const names = (body.files ?? []).map((f) => f.name).filter((n): n is string => !!n)
    if (names.length === 0) return { deleted, remaining: false }
    let pageOk = 0
    for (let i = 0; i < names.length; i += 10) {
      const results = await Promise.all(names.slice(i, i + 10).map((n) => deleteFile(n)))
      pageOk += results.filter(Boolean).length
    }
    deleted += pageOk
    if (pageOk === 0) return { deleted, remaining: true } // couldn't delete this page → stop (no spin)
    if (deleted >= max) return { deleted, remaining: true }
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

// Turn an uploaded File API record into a content Part, waiting for it to be ACTIVE first. Not-ready
// (still PROCESSING/FAILED) → throw PerceptionFileNotReady carrying the handle so a retry resumes it.
async function fileDataPart(uploaded: FileRecord, mimeType: string): Promise<{ part: Part; fileName?: string }> {
  const f = uploaded.state === 'ACTIVE' && uploaded.uri ? uploaded : await pollUntilReady(uploaded.name)
  if (f.state === 'ACTIVE' && f.uri) return { part: { fileData: { mimeType: f.mimeType || mimeType, fileUri: f.uri } }, fileName: f.name }
  // Only PROCESSING is worth resuming (it becomes ACTIVE given time) — preserve the handle for the
  // retry. FAILED/unknown means the upload is unusable: a plain error, so no handle is kept and the
  // next attempt re-uploads a fresh copy.
  if (f.state === 'PROCESSING') throw new PerceptionFileNotReady(f.uri ?? '', f.name, `Gemini 文件未就绪（PROCESSING）`)
  throw new Error(`Gemini 文件不可用（${f.state ?? 'unknown'}）`)
}

// Returns the content Part plus the File API `fileName` when the media was uploaded (undefined for
// small inline media) so the caller can delete it after use and not leak into the storage cap.
// `resume` = a handle a prior attempt uploaded but couldn't wait out; poll IT (likely ACTIVE by now)
// instead of re-uploading and restarting Gemini's ingest clock. If it's gone (expired), upload fresh.
async function mediaPart(mediaUrl: string, resume?: { uri: string; name: string }): Promise<{ part: Part; fileName?: string }> {
  if (resume?.name) {
    const f = await pollUntilReady(resume.name)
    if (f.state === 'ACTIVE' && f.uri) return { part: { fileData: { mimeType: f.mimeType || 'video/webm', fileUri: f.uri } }, fileName: f.name }
    if (f.state === 'PROCESSING') throw new PerceptionFileNotReady(f.uri ?? resume.uri, f.name, `Gemini 文件未就绪（PROCESSING）`)
    // GONE (expired/deleted) / FAILED / unknown → fall through and upload a fresh copy.
  }

  const resp = await fetch(mediaUrl, { signal: AbortSignal.timeout(NET_TIMEOUT_MS) })
  if (!resp.ok || !resp.body) throw new Error(`无法获取视频（${resp.status}）`)
  const mimeType = resp.headers.get('content-type') || 'video/webm'
  const declaredLen = Number(resp.headers.get('content-length') || '0')

  // Large files: stream straight into the File API without buffering in memory.
  if (declaredLen > INLINE_MAX_BYTES) {
    return fileDataPart(await uploadFile(resp.body, declaredLen, mimeType), mimeType)
  }
  const bytes = new Uint8Array(await resp.arrayBuffer())
  if (bytes.byteLength > INLINE_MAX_BYTES) {
    return fileDataPart(await uploadFile(bytes, bytes.byteLength, mimeType), mimeType)
  }
  return { part: { inlineData: { mimeType, data: toBase64(bytes) } } }
}

// Sanitize the model's per-sentence output before it's persisted: accuracy/completeness
// are contracts of [0,1] but a model can return a 0–100 value or junk, which would then
// slip past the weak-sentence analytics threshold and HIDE genuinely weak lines. Clamp to
// [0,1] (non-finite → 0), matching gradeShadowTake's guard.
export function normalizePerSentence(raw: unknown): PerSentenceResult[] {
  if (!Array.isArray(raw)) return []
  const clamp01 = (n: unknown) => (Number.isFinite(Number(n)) ? Math.max(0, Math.min(1, Number(n))) : 0)
  return raw.map((p) => {
    const r = (p ?? {}) as { order?: unknown; spokenText?: unknown; completeness?: unknown; accuracy?: unknown }
    return {
      order: Number(r.order) || 0,
      spokenText: typeof r.spokenText === 'string' ? r.spokenText : '',
      completeness: clamp01(r.completeness),
      accuracy: clamp01(r.accuracy),
    }
  })
}

export const geminiPerception: PerceptionProvider = {
  async perceive(input: PerceptionInput, modelId: string): Promise<PerceptionResult> {
    const media = input.videoUrl || input.audioUrl
    if (!media) throw new Error('没有可评阅的视频（请确认已配置 R2 并已上传）')
    const { part, fileName } = await mediaPart(media, input.resumeFile)
    const parts: Part[] = [{ text: buildPerceptionPrompt(input) }, part]
    try {
      const { data, usage } = await generate(modelId, parts, PERCEPTION_SCHEMA)
      const json = data as PerceptionResult
      return {
        transcript: json.transcript ?? '',
        perSentence: normalizePerSentence(json.perSentence),
        pronunciationImpression: json.pronunciationImpression,
        observations: json.observations ?? {},
        usage,
        raw: json,
      }
    } finally {
      // Free the File API storage the instant we're done — uploaded or not, success or failure.
      // Without this the 20 GiB/project cap fills and blocks all future uploads.
      if (fileName) await deleteFile(fileName)
    }
  },
}

export const geminiJudge: JudgeProvider = {
  async judge(input: JudgeInput, modelId: string): Promise<JudgeResult> {
    const { data, usage } = await generate(modelId, [{ text: buildJudgePrompt(input) }], JUDGE_SCHEMA)
    return { ...normalizeJudge(data, input.maxScore), usage }
  },
  async judgeText(input: TextJudgeInput, modelId: string): Promise<JudgeResult> {
    const { data, usage } = await generate(modelId, [{ text: buildWritingJudgePrompt(input) }], JUDGE_SCHEMA)
    return { ...normalizeJudge(data, input.maxScore), usage }
  },
}

// ── Authoring (备课出题) ──────────────────────────────────────────────────────

const AUTHOR_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    category: { type: 'STRING' },
    instructions: { type: 'STRING' },
    sentences: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['title', 'sentences'],
} as const

export function normalizeAuthorDraft(raw: unknown): AuthorDraft {
  const r = raw as { title?: unknown; category?: unknown; instructions?: unknown; sentences?: unknown }
  const sentences = Array.isArray(r?.sentences) ? r.sentences.map((s) => String(s).trim()).filter(Boolean) : []
  return {
    title: typeof r?.title === 'string' ? r.title.trim() : '',
    category: typeof r?.category === 'string' ? r.category.trim() : '',
    instructions: typeof r?.instructions === 'string' ? r.instructions.trim() : '',
    sentences,
  }
}

export function buildAuthorPrompt(topic: string, hasImage: boolean): string {
  return [
    '你是中职英语老师的备课助手，帮老师起草一份背诵 / 朗读类作业。',
    '请根据老师的要求' + (hasImage ? '和所附图片（课本 / 讲义页）' : '') + '，生成：',
    '- title：简洁的作业标题；',
    '- category：作业分类（如 背诵作业 / 口语作业 / 听写作业 等）；',
    '- instructions：给学生的简短说明（1-3 句）；',
    '- sentences：要背诵 / 朗读的句子，逐句一条，难度适合中职学生，5-12 句，不要编号。',
    '',
    topic ? `老师的要求：\n${topic}` : '（老师未填文字要求，请主要依据图片内容。）',
  ].join('\n')
}

// Gemini is the multimodal author: it can read a textbook photo inline alongside
// the teacher's brief. Also serves the text-only path when a Gemini model is picked.
export const geminiAuthor: AuthorProvider = {
  async author(input: AuthorInput, modelId: string): Promise<AuthorDraft> {
    const parts: Part[] = [{ text: buildAuthorPrompt(input.topic, Boolean(input.imageBase64)) }]
    if (input.imageBase64 && input.imageMime) {
      parts.push({ inlineData: { mimeType: input.imageMime, data: input.imageBase64 } })
    }
    const { data } = await generate(modelId, parts, AUTHOR_SCHEMA)
    return normalizeAuthorDraft(data)
  },
}
