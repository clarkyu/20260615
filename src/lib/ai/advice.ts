// 学期总评「AI 推荐比例」的模型调用(轻量 chat-JSON,同步秒级,不进评阅队列)。
// 输入只允许**班级聚合统计**(由 domain/review-advice 构造并单测保证零 PII);输出严格 JSON,
// 校验在 domain 层——AI 只出建议数字与文字理由,算术永远在代码。
import { COMPAT, compatChatJson } from './providers/openai-compat'
import type { TokenUsage } from './types'

export const ADVICE_MODEL = 'deepseek-v4-flash' // 纯文本、便宜;计费按 cost.ts 费率入账

export interface AdviceCategoryStat {
  key: 'classroom' | 'training' | 'final'
  label: string
  n: number // 有数据人数
  missing: number // 无数据人数
  mean: number | null
  median: number | null
  p25: number | null
  p75: number | null
  hist10: number[]
}

export interface AdvicePayload {
  course: string // 课程性质一句话(不含任何学生信息)
  students: number
  current: { classroom: number; training: number; final: number }
  bounds: Record<'classroom' | 'training' | 'final', [number, number]>
  categories: AdviceCategoryStat[]
  teacherNote?: string
}

export interface RawAdvice {
  data: unknown
  usage?: TokenUsage
  model: string
}

const SYSTEM =
  '你是教学评价顾问。你收到的是某班级的聚合统计(人数/均值/中位/分布),不含任何学生个体数据。' +
  '请为三类别(课堂表现/训练/期末)推荐总评比例。考虑:区分度(方差低的类别拉高权重会压缩总评方差)、' +
  '公平(期末占比过高则一次失手全学期不及格;课堂表现是追溯数据宜保守)、激励(持续参与应被看见)、' +
  '未成年人公平(比例波动对及格线的影响)。只输出 JSON,不要解释。'

const JSON_HINT =
  '\n\n只返回 JSON:{"weights":{"classroom":整数,"training":整数,"final":整数},"rationale":"面向老师的中文理由(≤120字)","cautions":["提醒(可空)"]}。' +
  '三个整数之和必须等于 100,且各自落在给定 bounds 区间内。'

export function adviseReviewWeights(payload: AdvicePayload, retryFeedback?: string): Promise<RawAdvice> {
  const messages = [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content:
        `班级聚合数据(JSON):\n${JSON.stringify(payload)}\n` +
        (retryFeedback ? `\n上次输出不合法:${retryFeedback}。请修正。` : '') +
        JSON_HINT,
    },
  ]
  return compatChatJson(COMPAT.deepseek, ADVICE_MODEL, messages).then((r) => ({ ...r, model: ADVICE_MODEL }))
}
