// 评阅用量 / 费用「粗略预估」。价格会变、各家计费口径不同，这里只取主价中位数做
// 数量级估算（事前预估，非账单）。展示侧务必标注「约」。
//
// token 估算用简单启发式：媒体按时长/张数折算，文本按字符折算；输出按每份固定量。
// 真实用量请以各家控制台账单为准。

// 每百万 token 的粗略单价（与 registry 的 MODEL_PRICING 展示口径一致，取主价/中位）。
// whisper 按音频分钟计费，单独用 perMinuteUsd。
interface Rate {
  inputPerM: number
  outputPerM: number
  currency: 'USD' | 'CNY'
  perMinuteUsd?: number
}

export const MODEL_RATES: Record<string, Rate> = {
  'gemini-2.5-flash': { inputPerM: 0.3, outputPerM: 2.5, currency: 'USD' },
  'gemini-3-flash-preview': { inputPerM: 0.5, outputPerM: 3.0, currency: 'USD' },
  'gemini-3.5-flash': { inputPerM: 1.5, outputPerM: 9.0, currency: 'USD' },
  'gemini-2.5-pro': { inputPerM: 1.875, outputPerM: 12.5, currency: 'USD' },
  'gemini-3.1-pro-preview': { inputPerM: 3.0, outputPerM: 15.0, currency: 'USD' },
  'qwen-omni-turbo': { inputPerM: 0.3, outputPerM: 0.6, currency: 'CNY' },
  'gpt-4o': { inputPerM: 2.5, outputPerM: 10.0, currency: 'USD' },
  'claude-opus-4-8': { inputPerM: 5.0, outputPerM: 25.0, currency: 'USD' },
  'deepseek-chat': { inputPerM: 1.0, outputPerM: 2.0, currency: 'CNY' },
  'MiniMax-Text-01': { inputPerM: 1.0, outputPerM: 8.0, currency: 'CNY' },
  'whisper-1': { inputPerM: 0, outputPerM: 0, currency: 'USD', perMinuteUsd: 0.006 },
}

// token 折算系数（粗略）。
const TOK = {
  videoPerSec: 260, // Gemini 视频约 258 tokens/秒
  audioPerSec: 25, //  音频约 25–32 tokens/秒
  imageTokens: 300, // 单张图约 258–300
  charsPerToken: 4, // 文本约 4 字符/token（中英混合粗估）
  outputPerSub: 400, // 每份评阅输出（分数 + 评语 JSON）约
  defaultVideoSec: 60, // 没记录到时长时的兜底
  defaultAudioSec: 30,
}

const CNY_PER_USD = 7.2

export interface SubInput {
  hasVideo: boolean
  hasAudio: boolean
  hasImage: boolean
  durationSec: number
  recitedLen: number
}

export interface GradingEstimate {
  count: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  usd: number
  cny: number
}

// 预估一个环节「全部 AI 评阅」的用量与费用。输入按感知模型单价、输出按评分模型单价；
// whisper 这种按分钟计的感知模型用 perMinuteUsd。币种不同的统一折成 USD（再给出 CNY）。
export function estimateGrading(
  subs: SubInput[],
  opts: { perceptionModel: string; judgeModel: string; rubricLen: number; sentencesLen: number },
): GradingEstimate {
  const pr = MODEL_RATES[opts.perceptionModel]
  const jr = MODEL_RATES[opts.judgeModel]
  const refTok = Math.ceil((Math.max(0, opts.rubricLen) + Math.max(0, opts.sentencesLen)) / TOK.charsPerToken)

  let inputTokens = 0
  let outputTokens = 0
  let whisperMin = 0
  for (const s of subs) {
    let media = 0
    if (s.hasVideo) media += (s.durationSec || TOK.defaultVideoSec) * TOK.videoPerSec
    if (s.hasAudio) {
      const sec = s.durationSec || TOK.defaultAudioSec
      media += sec * TOK.audioPerSec
      whisperMin += sec / 60
    }
    if (s.hasImage) media += TOK.imageTokens
    inputTokens += media + Math.ceil(Math.max(0, s.recitedLen) / TOK.charsPerToken) + refTok
    outputTokens += TOK.outputPerSub
  }

  const toUsd = (amt: number, cur: 'USD' | 'CNY') => (cur === 'USD' ? amt : amt / CNY_PER_USD)
  let usd = 0
  if (pr?.perMinuteUsd) usd += whisperMin * pr.perMinuteUsd
  else if (pr) usd += toUsd((inputTokens / 1e6) * pr.inputPerM, pr.currency)
  if (jr) usd += toUsd((outputTokens / 1e6) * jr.outputPerM, jr.currency)

  return {
    count: subs.length,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    usd,
    cny: usd * CNY_PER_USD,
  }
}

// 紧凑展示 token 数（语言中立，避免在 en/es 里出现中文「万」）：≥1M → X.XM，≥1k → Xk。
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}
