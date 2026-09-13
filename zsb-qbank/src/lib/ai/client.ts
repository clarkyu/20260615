// AI 调用(SPEC §9.1:OpenAI 兼容接口,配置全来自环境变量)。
// 不引 SDK,直接 fetch /chat/completions:温度 0、要求 JSON 输出、30 秒超时。
// 调用方通过 AiCaller 注入,测试用假实现,不打真接口(docs/DECISIONS.md D12)。

export interface AiConfig {
  baseUrl: string
  apiKey: string
  gradingModel: string
  authoringModel: string
  timeoutMs: number
}

export interface AiChatRequest {
  model: string
  system: string
  user: string
  maxTokens?: number
}

export interface AiChatResult {
  text: string
  model: string
  usage: { promptTokens: number; completionTokens: number }
  latencyMs: number
}

export type AiCaller = (req: AiChatRequest) => Promise<AiChatResult>

export type AiErrorKind = 'not_configured' | 'http' | 'timeout' | 'network' | 'bad_response'

export class AiError extends Error {
  constructor(
    message: string,
    public readonly kind: AiErrorKind,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'AiError'
  }
}

/** 读取 AI 配置;缺 AI_BASE_URL / AI_API_KEY / AI_MODEL_GRADING 任一项即视为未配置(返回 null)。 */
export function getAiConfig(env: Record<string, string | undefined> = process.env): AiConfig | null {
  const baseUrl = env.AI_BASE_URL?.trim()
  const apiKey = env.AI_API_KEY?.trim()
  const gradingModel = env.AI_MODEL_GRADING?.trim()
  if (!baseUrl || !apiKey || !gradingModel) return null
  const timeoutMs = Number(env.AI_TIMEOUT_MS ?? '') || 30_000
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    gradingModel,
    authoringModel: env.AI_MODEL_AUTHORING?.trim() || gradingModel,
    timeoutMs,
  }
}

export function aiConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return getAiConfig(env) !== null
}

/** 从模型回复里抠出 JSON(容忍 ```json 围栏与前后闲话)。 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start === -1 || end <= start) throw new AiError('回复不含 JSON', 'bad_response')
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      throw new AiError('回复 JSON 解析失败', 'bad_response')
    }
  }
}

export function createAiCaller(cfg: AiConfig, fetchImpl: typeof fetch = fetch): AiCaller {
  return async (req) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
    const started = Date.now()
    let res: Response
    try {
      res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: req.model,
          temperature: 0,
          max_tokens: req.maxTokens ?? 800,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
        signal: ctrl.signal,
      })
    } catch (e) {
      clearTimeout(timer)
      if (e instanceof Error && e.name === 'AbortError') throw new AiError(`AI 调用超时(${cfg.timeoutMs}ms)`, 'timeout')
      throw new AiError(`AI 调用网络失败:${e instanceof Error ? e.message : String(e)}`, 'network')
    }
    clearTimeout(timer)
    if (!res.ok) throw new AiError(`AI 接口返回 HTTP ${res.status}`, 'http', res.status)
    let body: {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
      model?: string
    }
    try {
      body = (await res.json()) as typeof body
    } catch {
      throw new AiError('AI 接口返回非 JSON', 'bad_response')
    }
    const text = body.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim()) throw new AiError('AI 接口未返回内容', 'bad_response')
    return {
      text,
      model: body.model ?? req.model,
      usage: { promptTokens: body.usage?.prompt_tokens ?? 0, completionTokens: body.usage?.completion_tokens ?? 0 },
      latencyMs: Date.now() - started,
    }
  }
}

/** 进程级默认调用器:未配置返回 null(调用方据此走「待评」分流,绝不崩溃)。 */
let _caller: AiCaller | null | undefined
export function getDefaultAiCaller(): AiCaller | null {
  if (_caller !== undefined) return _caller
  const cfg = getAiConfig()
  _caller = cfg ? createAiCaller(cfg) : null
  return _caller
}
