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
  // Gemini bills AUDIO input at a premium over text/image/video input; when set, audio
  // tokens use this rate instead of inputPerM (otherwise audio is under-estimated ~3×).
  audioInputPerM?: number
}

export const MODEL_RATES: Record<string, Rate> = {
  'gemini-2.5-flash': { inputPerM: 0.3, outputPerM: 2.5, currency: 'USD', audioInputPerM: 1.0 },
  'gemini-3-flash-preview': { inputPerM: 0.5, outputPerM: 3.0, currency: 'USD', audioInputPerM: 1.0 },
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

// 预估一个环节「全部 AI 评阅」的用量与费用。评阅是两段式（感知 perceive → 评分 judge），
// 这里把两段都算上：感知输入(媒体+参考句)+感知输出(转写)按感知模型单价，评分输入(转写+
// 评分标准+参考句+背诵文本)+评分输出(分数+评语)按评分模型单价。Gemini 音频按音频单价、
// 其余输入按基础单价。whisper 这种按分钟计的感知模型用 perMinuteUsd（转写不另计 token 输出）。
// 币种不同的统一折成 USD（再给出 CNY）。仍是「约」——真实用量以各家控制台账单为准。
export function estimateGrading(
  subs: SubInput[],
  opts: { perceptionModel: string; judgeModel: string; rubricLen: number; sentencesLen: number },
): GradingEstimate {
  const pr = MODEL_RATES[opts.perceptionModel]
  const jr = MODEL_RATES[opts.judgeModel]
  const refTok = Math.ceil((Math.max(0, opts.rubricLen) + Math.max(0, opts.sentencesLen)) / TOK.charsPerToken)

  let percOtherInput = 0 // 感知输入里按基础单价计的部分（视频/图/文）
  let percAudioInput = 0 // 感知输入里的音频（按音频单价，Gemini 有溢价）
  let perceptionOutput = 0 // 感知输出（转写）
  let judgeInput = 0 // 评分输入（转写 + 参考材料 + 背诵文本）
  let judgeOutput = 0 // 评分输出（分数 + 评语）
  let whisperMin = 0
  for (const s of subs) {
    let media = 0
    if (s.hasVideo) media += (s.durationSec || TOK.defaultVideoSec) * TOK.videoPerSec
    if (s.hasImage) media += TOK.imageTokens
    if (s.hasAudio) {
      const sec = s.durationSec || TOK.defaultAudioSec
      percAudioInput += sec * TOK.audioPerSec
      whisperMin += sec / 60
    }
    const recited = Math.ceil(Math.max(0, s.recitedLen) / TOK.charsPerToken)
    percOtherInput += media + recited + refTok
    perceptionOutput += TOK.outputPerSub
    // 评分阶段要重读感知转写 + 参考材料 + 背诵文本——这段此前完全没算进去。
    judgeInput += refTok + TOK.outputPerSub + recited
    judgeOutput += TOK.outputPerSub
  }

  const toUsd = (amt: number, cur: 'USD' | 'CNY') => (cur === 'USD' ? amt : amt / CNY_PER_USD)
  let usd = 0
  // 感知：whisper 按分钟；其余按 token（音频用音频单价）。
  if (pr?.perMinuteUsd) {
    usd += whisperMin * pr.perMinuteUsd
  } else if (pr) {
    usd += toUsd((percOtherInput / 1e6) * pr.inputPerM, pr.currency)
    usd += toUsd((percAudioInput / 1e6) * (pr.audioInputPerM ?? pr.inputPerM), pr.currency)
    usd += toUsd((perceptionOutput / 1e6) * pr.outputPerM, pr.currency)
  }
  // 评分：输入 + 输出。
  if (jr) {
    usd += toUsd((judgeInput / 1e6) * jr.inputPerM, jr.currency)
    usd += toUsd((judgeOutput / 1e6) * jr.outputPerM, jr.currency)
  }

  const inputTokens = percOtherInput + percAudioInput + judgeInput
  const outputTokens = perceptionOutput + judgeOutput
  return {
    count: subs.length,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    usd,
    cny: usd * CNY_PER_USD,
  }
}

// 真实成本（USD）：给定一次模型调用的【实际】token 用量，按 MODEL_RATES 折算。用于把
// provider 回报的真实用量换成钱、落库观测。与 estimateGrading 的事前估算不同——这里吃的是
// 真实 token。whisper（按分钟、token 单价为 0）在这里得 0（其音频成本不走 token）；未知模型
// 也得 0。注意：provider 回报的是总 promptTokens，不区分模态，故音频溢价无法施加于真实用量，
// 这里一律用基础 inputPerM（对音频重的调用会略微低估）。
export function costUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const r = MODEL_RATES[modelId]
  if (!r) return 0
  const raw = (Math.max(0, inputTokens) / 1e6) * r.inputPerM + (Math.max(0, outputTokens) / 1e6) * r.outputPerM
  return r.currency === 'CNY' ? raw / CNY_PER_USD : raw
}

// 紧凑展示 token 数（语言中立，避免在 en/es 里出现中文「万」）：≥1M → X.XM，≥1k → Xk。
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}
