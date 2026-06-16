import type {
  JudgeInput,
  JudgeResult,
  PerceptionInput,
  PerceptionProvider,
  PerceptionResult,
  JudgeProvider,
  ReferenceSentence,
} from '../types'

// Real Gemini adapter (REST API via fetch — Workers-compatible, no SDK).
// Perception (multimodal: video/audio) and judging (text) both go to Gemini
// with structured JSON output. Configure GEMINI_API_KEY (+ optional
// GEMINI_BASE_URL to route through a proxy).

function baseUrl(): string {
  return (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '')
}

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY 未配置')
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

export function normalizeJudge(raw: unknown, maxScore: number): JudgeResult {
  const r = raw as { score?: unknown; breakdown?: { dimension?: string; points?: number }[]; feedback?: unknown; confidence?: unknown }
  const score = Math.max(0, Math.min(maxScore, Math.round(Number(r?.score) || 0)))
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

async function generate(model: string, parts: Part[], schema: unknown): Promise<unknown> {
  const res = await fetch(`${baseUrl()}/v1beta/models/${model}:generateContent?key=${apiKey()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.2 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return extractJson(await res.json())
}

const INLINE_MAX_BYTES = 18 * 1024 * 1024 // inline base64 is limited; larger goes through the File API

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

// Uploads media to the Gemini File API (resumable) and waits until ACTIVE.
async function uploadFile(body: BodyInit, contentLength: number, mimeType: string): Promise<string> {
  const key = apiKey()
  const start = await fetch(`${baseUrl()}/upload/v1beta/files?key=${key}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(contentLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: 'recitation' } }),
  })
  if (!start.ok) throw new Error(`Gemini 文件上传初始化失败 ${start.status}`)
  const uploadUrl = start.headers.get('X-Goog-Upload-URL')
  if (!uploadUrl) throw new Error('Gemini 未返回上传地址')

  const up = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body,
    // Streaming request body requires half-duplex.
    ...({ duplex: 'half' } as Record<string, unknown>),
  })
  if (!up.ok) throw new Error(`Gemini 文件上传失败 ${up.status}`)
  let file = (await up.json() as { file?: { uri?: string; name?: string; state?: string } }).file
  for (let i = 0; i < 30 && file?.state === 'PROCESSING'; i++) {
    await sleep(2000)
    const poll = await fetch(`${baseUrl()}/v1beta/${file.name}?key=${key}`)
    file = (await poll.json()) as { uri?: string; name?: string; state?: string }
  }
  if (file?.state !== 'ACTIVE' || !file.uri) throw new Error(`Gemini 文件未就绪（${file?.state ?? 'unknown'}）`)
  return file.uri
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

async function mediaPart(mediaUrl: string): Promise<Part> {
  const resp = await fetch(mediaUrl)
  if (!resp.ok || !resp.body) throw new Error(`无法获取视频（${resp.status}）`)
  const mimeType = resp.headers.get('content-type') || 'video/webm'
  const declaredLen = Number(resp.headers.get('content-length') || '0')

  // Large files: stream straight into the File API without buffering in memory.
  if (declaredLen > INLINE_MAX_BYTES) {
    const uri = await uploadFile(resp.body, declaredLen, mimeType)
    return { fileData: { mimeType, fileUri: uri } }
  }
  const bytes = new Uint8Array(await resp.arrayBuffer())
  if (bytes.byteLength > INLINE_MAX_BYTES) {
    const uri = await uploadFile(bytes, bytes.byteLength, mimeType)
    return { fileData: { mimeType, fileUri: uri } }
  }
  return { inlineData: { mimeType, data: toBase64(bytes) } }
}

export const geminiPerception: PerceptionProvider = {
  async perceive(input: PerceptionInput, modelId: string): Promise<PerceptionResult> {
    const media = input.videoUrl || input.audioUrl
    if (!media) throw new Error('没有可评阅的视频（请确认已配置 R2 并已上传）')
    const parts: Part[] = [{ text: buildPerceptionPrompt(input) }, await mediaPart(media)]
    const json = (await generate(modelId, parts, PERCEPTION_SCHEMA)) as PerceptionResult
    return {
      transcript: json.transcript ?? '',
      perSentence: Array.isArray(json.perSentence) ? json.perSentence : [],
      pronunciationImpression: json.pronunciationImpression,
      observations: json.observations ?? {},
      raw: json,
    }
  },
}

export const geminiJudge: JudgeProvider = {
  async judge(input: JudgeInput, modelId: string): Promise<JudgeResult> {
    const json = await generate(modelId, [{ text: buildJudgePrompt(input) }], JUDGE_SCHEMA)
    return normalizeJudge(json, input.maxScore)
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

export interface AuthorDraft {
  title: string
  category: string
  instructions: string
  sentences: string[]
}

export interface AuthorInput {
  topic: string
  imageBase64?: string
  imageMime?: string
}

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

export async function geminiAuthor(input: AuthorInput, modelId: string): Promise<AuthorDraft> {
  const parts: Part[] = [{ text: buildAuthorPrompt(input.topic, Boolean(input.imageBase64)) }]
  if (input.imageBase64 && input.imageMime) {
    parts.push({ inlineData: { mimeType: input.imageMime, data: input.imageBase64 } })
  }
  const json = await generate(modelId, parts, AUTHOR_SCHEMA)
  return normalizeAuthorDraft(json)
}
