import type { JudgeInput, JudgeResult, JudgeProvider } from '../types'
import { buildJudgePrompt, normalizeJudge, stripCodeFence } from './gemini'
import { overrideKey } from '../key-context'
import { unavailable } from '../errors'
import { config } from '@/lib/config'

// Anthropic Claude as a text judge. It scores from the perception result + reference text
// like the OpenAI-compatible judges, but the Messages API shape differs (x-api-key +
// anthropic-version headers, a `content` block response). Pair it with any perception
// provider.

// Must match the JSON shape normalizeJudge parses.
const JUDGE_JSON_HINT =
  '\n\n只返回 JSON，不要解释：{"score": number, "breakdown": [{"dimension": string, "points": number}], "feedback": string}'

function apiKey(): string {
  // The grading teacher's own key (BYOK) wins; otherwise the platform key.
  const key = overrideKey('claude') ?? config.anthropicKey()
  if (!key) throw unavailable('ANTHROPIC_API_KEY 未配置')
  return key
}

export const claudeJudge: JudgeProvider = {
  async judge(input: JudgeInput, modelId: string): Promise<JudgeResult> {
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
        system: '你是英语背诵作业的阅卷老师，只输出 JSON。',
        messages: [{ role: 'user', content: buildJudgePrompt(input) + JUDGE_JSON_HINT }],
      }),
      // Don't let a stalled upstream pin the isolate to the platform wall-clock limit.
      signal: AbortSignal.timeout(180_000),
    })
    if (!res.ok) throw new Error(`claude ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } }
    const text = data.content?.find((c) => c.type === 'text')?.text
    if (!text) throw new Error('模型无有效返回')
    const usage = data.usage ? { inputTokens: Number(data.usage.input_tokens) || 0, outputTokens: Number(data.usage.output_tokens) || 0 } : undefined
    return { ...normalizeJudge(JSON.parse(stripCodeFence(text)), input.maxScore), usage }
  },
}
