import type {
  AuthorDraft,
  AuthorInput,
  AuthorProvider,
  JudgeInput,
  JudgeResult,
  PerceptionInput,
  PerceptionProvider,
  PerceptionResult,
  JudgeProvider,
  Provider,
  TextJudgeInput,
  TokenUsage,
} from '../types'
import { buildAuthorPrompt, buildJudgePrompt, buildPerceptionPrompt, buildWritingJudgePrompt, normalizeAuthorDraft, normalizeJudge, normalizePerSentence, stripCodeFence } from './gemini'
import { overrideKey } from '../key-context'
import { unavailable } from '../errors'
import { UPSTREAM_TIMEOUT_MS } from '../net'
import { config } from '@/lib/config'

// Shared adapter for OpenAI-compatible chat APIs: Qwen (DashScope compatible
// mode), MiniMax, DeepSeek, OpenAI. They differ only in base URL + path + auth,
// so one client + per-provider config covers them all.

export interface CompatConfig {
  provider: Provider
  baseUrl: string
  baseUrlEnv: string // optional override (region/proxy)
  chatPath: string
  apiKeyEnv: string
  groupIdEnv?: string // MiniMax may require a GroupId query param
}

export const COMPAT: Record<'qwen' | 'minimax' | 'deepseek' | 'openai', CompatConfig> = {
  qwen: {
    provider: 'qwen',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    baseUrlEnv: 'QWEN_BASE_URL',
    chatPath: '/chat/completions',
    apiKeyEnv: 'QWEN_API_KEY',
  },
  minimax: {
    provider: 'minimax',
    baseUrl: 'https://api.minimaxi.chat/v1',
    baseUrlEnv: 'MINIMAX_BASE_URL',
    chatPath: '/text/chatcompletion_v2',
    apiKeyEnv: 'MINIMAX_API_KEY',
    groupIdEnv: 'MINIMAX_GROUP_ID',
  },
  deepseek: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    baseUrlEnv: 'DEEPSEEK_BASE_URL',
    chatPath: '/chat/completions',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
  },
  openai: {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    baseUrlEnv: 'OPENAI_BASE_URL',
    chatPath: '/chat/completions',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
}

function apiKey(cfg: CompatConfig): string {
  // The grading teacher's own key (BYOK) wins; otherwise the platform key.
  const key = overrideKey(cfg.provider) ?? config.env(cfg.apiKeyEnv)
  if (!key) throw unavailable(`${cfg.apiKeyEnv} 未配置`)
  return key
}

// Parses the JSON content out of an OpenAI-compatible chat response (also
// surfaces MiniMax's base_resp error envelope).
export function parseChatJson(data: unknown): unknown {
  const d = data as {
    choices?: { message?: { content?: string } }[]
    base_resp?: { status_code?: number; status_msg?: string }
  }
  if (d?.base_resp && typeof d.base_resp.status_code === 'number' && d.base_resp.status_code !== 0) {
    throw new Error(`接口错误: ${d.base_resp.status_msg ?? d.base_resp.status_code}`)
  }
  const content = d?.choices?.[0]?.message?.content
  if (!content) throw new Error('模型无有效返回')
  return JSON.parse(stripCodeFence(content))
}

type Content = string | Array<Record<string, unknown>>

// Real token usage from an OpenAI-compatible chat response (undefined when absent).
export function extractCompatUsage(data: unknown): TokenUsage | undefined {
  const u = (data as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage
  if (!u) return undefined
  const inTok = Number(u.prompt_tokens)
  const outTok = Number(u.completion_tokens)
  // A usage envelope missing BOTH split fields (e.g. MiniMax's chatcompletion_v2, which reports
  // only total_tokens) can't be priced by (input, output) rates — return undefined ("cost unknown")
  // so the domain persists a NULL cost, not a fake $0 measurement that pollutes the spend dashboard.
  if (!Number.isFinite(inTok) && !Number.isFinite(outTok)) return undefined
  return { inputTokens: Number.isFinite(inTok) ? inTok : 0, outputTokens: Number.isFinite(outTok) ? outTok : 0 }
}

async function chat(cfg: CompatConfig, model: string, messages: { role: string; content: Content }[]): Promise<{ data: unknown; usage?: TokenUsage }> {
  const base = (config.env(cfg.baseUrlEnv) || cfg.baseUrl).replace(/\/$/, '')
  const groupId = cfg.groupIdEnv ? config.env(cfg.groupIdEnv) : undefined
  const url = `${base}${cfg.chatPath}` + (groupId ? `?GroupId=${encodeURIComponent(groupId)}` : '')
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey(cfg)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.2 }),
    // Don't let a stalled upstream pin the isolate to the platform wall-clock limit.
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`${cfg.provider} ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const raw = await res.json()
  return { data: parseChatJson(raw), usage: extractCompatUsage(raw) }
}

// 通用 chat-JSON 出口(比例推荐等轻量文本任务用):复用同一网络/BYOK/超时/JSON 解析管线。
export function compatChatJson(cfg: CompatConfig, model: string, messages: { role: string; content: Content }[]): Promise<{ data: unknown; usage?: TokenUsage }> {
  return chat(cfg, model, messages)
}

// Must include `confidence` — decideReview reads it to auto-approve high-confidence clean
// submissions ("AI 先批、只看例外"). Omitting it makes normalizeJudge yield undefined, which
// decideReview treats as fail-safe (always needs review), silently disabling auto-approval.
const JUDGE_JSON_HINT =
  '\n\n只返回 JSON，不要解释：{"score": number, "breakdown": [{"dimension": string, "points": number}], "feedback": string, "confidence": number}'

const PERCEPTION_JSON_HINT =
  '\n\n只返回 JSON，不要解释：{"transcript": string, "perSentence": [{"order": number, "spokenText": string, "completeness": number, "accuracy": number}], "pronunciationImpression": string, "observations": {"eyesClosed": boolean, "readingSuspected": boolean, "facePresent": boolean, "continuousTake": boolean, "notes": string}}'

const AUTHOR_JSON_HINT =
  '\n\n只返回 JSON，不要解释：{"title": string, "category": string, "instructions": string, "sentences": [string]}'

export function makeJudge(cfg: CompatConfig): JudgeProvider {
  return {
    async judge(input: JudgeInput, modelId: string): Promise<JudgeResult> {
      const messages = [
        { role: 'system', content: '你是英语背诵作业的阅卷老师，只输出 JSON。' },
        { role: 'user', content: buildJudgePrompt(input) + JUDGE_JSON_HINT },
      ]
      const { data, usage } = await chat(cfg, modelId, messages)
      return { ...normalizeJudge(data, input.maxScore), usage }
    },
    async judgeText(input: TextJudgeInput, modelId: string): Promise<JudgeResult> {
      const messages = [
        { role: 'system', content: '你是英语写作阅卷老师，只输出 JSON。' },
        { role: 'user', content: buildWritingJudgePrompt(input) + JUDGE_JSON_HINT },
      ]
      const { data, usage } = await chat(cfg, modelId, messages)
      return { ...normalizeJudge(data, input.maxScore), usage }
    },
  }
}

export function makePerception(cfg: CompatConfig): PerceptionProvider {
  return {
    async perceive(input: PerceptionInput, modelId: string): Promise<PerceptionResult> {
      const media = input.videoUrl || input.audioUrl
      if (!media) throw new Error('没有可评阅的视频（请确认已配置 R2 并已上传）')
      const messages = [
        { role: 'system', content: '你是英语背诵评阅助手，只输出 JSON。' },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPerceptionPrompt(input) + PERCEPTION_JSON_HINT },
            { type: 'video_url', video_url: { url: media } },
          ],
        },
      ]
      const { data, usage } = await chat(cfg, modelId, messages)
      const json = data as PerceptionResult
      return {
        transcript: json.transcript ?? '',
        perSentence: normalizePerSentence(json.perSentence),
        pronunciationImpression: json.pronunciationImpression,
        observations: json.observations ?? {},
        usage,
        raw: json,
      }
    },
  }
}

// Text authoring (备课出题) over an OpenAI-compatible chat API. Topic-only — the
// textbook-photo path is routed to Gemini upstream, so no image is sent here.
export function makeAuthor(cfg: CompatConfig): AuthorProvider {
  return {
    async author(input: AuthorInput, modelId: string): Promise<AuthorDraft> {
      const messages = [
        { role: 'system', content: '你是中职英语老师的备课助手，只输出 JSON。' },
        { role: 'user', content: buildAuthorPrompt(input.topic, false) + AUTHOR_JSON_HINT },
      ]
      const { data } = await chat(cfg, modelId, messages)
      return normalizeAuthorDraft(data)
    },
  }
}

// Ready-made providers.
export const qwenJudge = makeJudge(COMPAT.qwen)
export const qwenPerception = makePerception(COMPAT.qwen)
export const qwenAuthor = makeAuthor(COMPAT.qwen)
export const minimaxJudge = makeJudge(COMPAT.minimax)
export const minimaxAuthor = makeAuthor(COMPAT.minimax)
export const deepseekJudge = makeJudge(COMPAT.deepseek)
export const deepseekAuthor = makeAuthor(COMPAT.deepseek)
export const openaiJudge = makeJudge(COMPAT.openai)
// No openaiPerception: OpenAI Chat Completions can't take the video the perception path sends
// (that shape is Qwen-only); OpenAI-side speech perception is Whisper's job. gpt-4o is judge/author
// only (audit A9). makePerception stays — Qwen uses it (qwen-omni does accept video_url).
export const openaiAuthor = makeAuthor(COMPAT.openai)
