// 间隔复习(SPEC §10 M6:间隔 1、3、7、14、30 天,错题重置):纯函数。
// 复习卡只为「答错过」的题建立(错题本);答对按阶梯拉长间隔,答错回到 1 天并记一次遗忘。

export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30] as const
export const DAY_MS = 24 * 60 * 60 * 1000

export interface ReviewCardState {
  dueAt: Date
  intervalDays: number
  ease: number
  streak: number
  lapses: number
  lastResult: string | null
}

/** 第 n 次连续答对对应的间隔(超出阶梯封顶 30 天)。 */
export function intervalForStreak(streak: number): number {
  const i = Math.max(0, Math.min(REVIEW_INTERVALS_DAYS.length - 1, streak - 1))
  return REVIEW_INTERVALS_DAYS[i]!
}

/**
 * 作答后的新卡状态。card 为 null 表示这题还没有复习卡:答错才建卡(次日到期);答对不建卡。
 * 已有卡:答对 streak+1 → 下一阶梯;答错 streak 归零、lapses+1 → 1 天后再来(错题重置)。
 */
export function nextReview(card: ReviewCardState | null, correct: boolean, now: Date): ReviewCardState | null {
  if (!card) {
    if (correct) return null
    return { dueAt: new Date(now.getTime() + DAY_MS), intervalDays: 1, ease: 2.5, streak: 0, lapses: 1, lastResult: 'wrong' }
  }
  if (correct) {
    const streak = card.streak + 1
    const intervalDays = intervalForStreak(streak)
    return { ...card, streak, intervalDays, dueAt: new Date(now.getTime() + intervalDays * DAY_MS), lastResult: 'correct' }
  }
  return { ...card, streak: 0, lapses: card.lapses + 1, intervalDays: 1, dueAt: new Date(now.getTime() + DAY_MS), lastResult: 'wrong' }
}

/** 是否已「掌握」:连对走完整个阶梯(30 天间隔之后再答对)。 */
export function isMastered(card: ReviewCardState): boolean {
  return card.streak > REVIEW_INTERVALS_DAYS.length
}

/** 北京时间的「今天 0 点」(每日任务与今日复习的日界)。 */
export function startOfDayShanghai(now: Date): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
  const ymd = fmt.format(now) // YYYY-MM-DD
  return new Date(`${ymd}T00:00:00+08:00`)
}
