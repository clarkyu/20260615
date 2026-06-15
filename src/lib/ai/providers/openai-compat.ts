import type {
  JudgeInput,
  JudgeResult,
  PerceptionInput,
  PerceptionProvider,
  PerceptionResult,
  JudgeProvider,
  Provider,
} from '../types'
import { buildJudgePrompt, buildPerceptionPrompt, normalizeJudge, stripCodeFence } from './gemini'

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
  const key = process.env[cfg.apiKeyEnv]
  if (!key) throw new Error(`${cfg.apiKeyEnv} 未配置`)
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

async function chat(cfg: CompatConfig, model: string, messages: { role: string; content: Content }[]): Promise<unknown> {
  const base = (process.env[cfg.baseUrlEnv] || cfg.baseUrl).replace(/\/$/, '')
  const groupId = cfg.groupIdEnv ? process.env[cfg.groupIdEnv] : undefined
  const url = `${base}${cfg.chatPath}` + (groupId ? `?GroupId=${encodeURIComponent(groupId)}` : '')
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey(cfg)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.2 }),
  })
  if (!res.ok) throw new Error(`${cfg.provider} ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return parseChatJson(await res.json())
}

const JUDGE_JSON_HINT =
  '\n\n只返回 JSON，不要解释：{"score": number, "breakdown": [{"dimension": string, "points": number}], "feedback": string}'

const PERCEPTION_JSON_HINT =
  '\n\n只返回 JSON，不要解释：{"transcript": string, "perSentence": [{"order": number, "spokenText": string, "completeness": number, "accuracy": number}], "pronunciationImpression": string, "observations": {"eyesClosed": boolean, "readingSuspected": boolean, "facePresent": boolean, "continuousTake": boolean, "notes": string}}'

export function makeJudge(cfg: CompatConfig): JudgeProvider {
  return {
    async judge(input: JudgeInput, modelId: string): Promise<JudgeResult> {
      const messages = [
        { role: 'system', content: '你是英语背诵作业的阅卷老师，只输出 JSON。' },
        { role: 'user', content: buildJudgePrompt(input) + JUDGE_JSON_HINT },
      ]
      return normalizeJudge(await chat(cfg, modelId, messages), input.maxScore)
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
      const json = (await chat(cfg, modelId, messages)) as PerceptionResult
      return {
        transcript: json.transcript ?? '',
        perSentence: Array.isArray(json.perSentence) ? json.perSentence : [],
        pronunciationImpression: json.pronunciationImpression,
        observations: json.observations ?? {},
        raw: json,
      }
    },
  }
}

// Ready-made providers.
export const qwenJudge = makeJudge(COMPAT.qwen)
export const qwenPerception = makePerception(COMPAT.qwen)
export const minimaxJudge = makeJudge(COMPAT.minimax)
export const deepseekJudge = makeJudge(COMPAT.deepseek)
export const openaiJudge = makeJudge(COMPAT.openai)
export const openaiPerception = makePerception(COMPAT.openai)
