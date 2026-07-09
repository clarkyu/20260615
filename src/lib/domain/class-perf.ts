// 课堂表现分(雨课堂)——公式 B 纯函数。四信号全二值、按「当天该功能是否开放」归一,
// 算术全在代码、可单测、绝不过 LLM。公平性护栏(对抗复核必改项,详见
// docs/SESSION-2026-07-09-RECOVERY.md §3):
// - 二值参与:当天发过 ≥1 条即算参与该节(66 条不比 1 条多分,防刷屏、不诱导灌水);
//   条数只进图表展示、不进评分。
// - 分母只数「计次节」(重开课被平台从汇总剔除,所有信号统一剔,口径自洽);
//   且弹幕/投稿/答题只数「当天开放」的节——不惩罚老师没开的功能。
// - 某信号整学期没开(分母 0)⇒ 剔除并把权重摊给其余信号(重归一),不给全班扣分。
// - 保底(默认开):到课率 ≥80% ⇒ 课堂表现分 ≥60——「孩子每节都到了却不及格」对 minors
//   无法辩护;被保底救起的学生名单由导入预览列出供老师知情。
// - 「答题按是否作答计参与、不评对错」须写进学生可见文案(未批改/瞎选都算答过)。

import type { RainSession, RainStudentDetail } from '@/lib/rain-classroom'

export interface ClassPerfWeights {
  attendance: number // 整数百分比,四项 Σ=100
  danmaku: number
  posts: number
  answers: number
  floor: boolean // 到课率≥80% ⇒ 分数≥60
}

export const CLASSPERF_DEFAULT_WEIGHTS: ClassPerfWeights = {
  attendance: 50,
  danmaku: 15,
  posts: 15,
  answers: 20,
  floor: true,
}

// 追溯宽松预设(规则晚于行为公布的学期,考勤主导、参与只作小幅加成)——2026 春季这批
// 3-6 月数据在 7 月才定规则,默认用它;新学期开学即公布规则后可换默认预设。
export const CLASSPERF_LENIENT_WEIGHTS: ClassPerfWeights = {
  attendance: 70,
  danmaku: 10,
  posts: 10,
  answers: 10,
  floor: true,
}

export function validateClassPerfWeights(w: ClassPerfWeights): string | null {
  const parts = [w.attendance, w.danmaku, w.posts, w.answers]
  if (parts.some((x) => !Number.isInteger(x) || x < 0 || x > 100)) return 'classperf.errWeightRange'
  if (parts.reduce((a, b) => a + b, 0) !== 100) return 'classperf.errWeightSum'
  return null
}

export interface ClassPerfRates {
  attendance: number | null // 到课节 / 计次节;分母 0 ⇒ null(信号不适用)
  danmaku: number | null // 活跃节 / (计次且开弹幕)节
  posts: number | null
  answers: number | null // 答过≥1题的节 / (计次且有题)节
}

export function classPerfRates(detail: RainStudentDetail[], sessions: RainSession[]): ClassPerfRates {
  let attN = 0
  let att = 0
  let danN = 0
  let dan = 0
  let postN = 0
  let post = 0
  let ansN = 0
  let ans = 0
  sessions.forEach((s, i) => {
    if (!s.counted) return // 重开课等不计次节:只展示,不进任何分母
    const d = detail[i] ?? { attended: false, danmaku: 0, posts: 0, answered: false }
    attN++
    if (d.attended) att++
    if (s.danmakuOpen) {
      danN++
      if (d.danmaku > 0) dan++
    }
    if (s.postOpen) {
      postN++
      if (d.posts > 0) post++
    }
    if (s.questions > 0) {
      ansN++
      if (d.answered) ans++
    }
  })
  const rate = (num: number, den: number) => (den > 0 ? num / den : null)
  return { attendance: rate(att, attN), danmaku: rate(dan, danN), posts: rate(post, postN), answers: rate(ans, ansN) }
}

export interface ClassPerfScore {
  score: number | null // 0-100,round1;全部信号不适用 ⇒ null(无数据,非 0)
  rates: ClassPerfRates
  floored: boolean // 被保底从更低值抬到 60
}

export function computeClassPerfScore(
  detail: RainStudentDetail[],
  sessions: RainSession[],
  w: ClassPerfWeights,
): ClassPerfScore {
  const rates = classPerfRates(detail, sessions)
  const parts: { rate: number | null; weight: number }[] = [
    { rate: rates.attendance, weight: w.attendance },
    { rate: rates.danmaku, weight: w.danmaku },
    { rate: rates.posts, weight: w.posts },
    { rate: rates.answers, weight: w.answers },
  ]
  let sum = 0
  let wsum = 0
  for (const p of parts) {
    if (p.rate == null) continue // 死信号剔除,权重自然摊给其余(除以 wsum 即重归一)
    sum += p.rate * p.weight
    wsum += p.weight
  }
  if (wsum === 0) return { score: null, rates, floored: false }
  let score = (100 * sum) / wsum
  let floored = false
  if (w.floor && (rates.attendance ?? 0) >= 0.8 && score < 60) {
    score = 60
    floored = true
  }
  score = Math.max(0, Math.min(100, Math.round(score * 10) / 10))
  return { score, rates, floored }
}
