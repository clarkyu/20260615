import type { AuthorDraft, AuthorInput, AuthorProvider, JudgeInput, JudgeResult, JudgeProvider, TextJudgeInput, TokenUsage } from '../types'
import { buildAuthorPrompt, buildJudgePrompt, buildWritingJudgePrompt, normalizeAuthorDraft, normalizeJudge, stripCodeFence } from './gemini'
import { overrideKey } from '../key-context'
import { unavailable } from '../errors'
import { config } from '@/lib/config'

// Anthropic Claude as a text judge (and text author). It scores from the perception
// result + reference text like the OpenAI-compatible judges, but the Messages API shape
// differs (x-api-key + anthropic-version headers, a `content` block response). Pair it
// with any perception provider.

// Must match the JSON shape normalizeJudge parses.
const JUDGE_JSON_HINT =
  '\n\n只返回 JSON，不要解释：{"score": number, "breakdown": [{"dimension": string, "points": number}], "feedback": string}'

// Must match the JSON shape normalizeAuthorDraft parses.
const AUTHOR_JSON_HINT =
  '\n\n只返回 JSON，不要解释：{"title": string, "category": string, "instructions": string, "sentences": [string]}'

function apiKey(): string {
  // The grading teacher's own key (BYOK) wins; otherwise the platform key.
  const key = overrideKey('claude') ?? config.anthropicKey()
  if (!key) throw unavailable('ANTHROPIC_API_KEY 未配置')
  return key
}

// One Messages-API call → the model's text reply + real token usage. Shared by the
// judges and the author — they differ only in system prompt, user content, and how the
// returned JSON text is normalized.
async function callClaude(system: string, userContent: string, modelId: string): Promise<{ text: string; usage?: TokenUsage }> {
  const base = config.anthropicBaseUrl().replace(/\/$/, '')
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 1024,
      temperature: 0.2,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
    // Don't let a stalled upstream pin the isolate to the platform wall-clock limit.
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok) throw new Error(`claude ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } }
  const text = data.content?.find((c) => c.type === 'text')?.text
  if (!text) throw new Error('模型无有效返回')
  const usage = data.usage ? { inputTokens: Number(data.usage.input_tokens) || 0, outputTokens: Number(data.usage.output_tokens) || 0 } : undefined
  return { text, usage }
}

async function judgeCall(system: string, userContent: string, modelId: string, maxScore: number): Promise<JudgeResult> {
  const { text, usage } = await callClaude(system, userContent, modelId)
  return { ...normalizeJudge(JSON.parse(stripCodeFence(text)), maxScore), usage }
}

export const claudeJudge: JudgeProvider = {
  judge(input: JudgeInput, modelId: string): Promise<JudgeResult> {
    return judgeCall('你是英语背诵作业的阅卷老师，只输出 JSON。', buildJudgePrompt(input) + JUDGE_JSON_HINT, modelId, input.maxScore)
  },
  judgeText(input: TextJudgeInput, modelId: string): Promise<JudgeResult> {
    return judgeCall('你是英语写作阅卷老师，只输出 JSON。', buildWritingJudgePrompt(input) + JUDGE_JSON_HINT, modelId, input.maxScore)
  },
}

// Text authoring — topic-only (the textbook-photo path is routed to Gemini upstream).
export const claudeAuthor: AuthorProvider = {
  async author(input: AuthorInput, modelId: string): Promise<AuthorDraft> {
    const { text } = await callClaude('你是中职英语老师的备课助手，只输出 JSON。', buildAuthorPrompt(input.topic, false) + AUTHOR_JSON_HINT, modelId)
    return normalizeAuthorDraft(JSON.parse(stripCodeFence(text)))
  },
}
