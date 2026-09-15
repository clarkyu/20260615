// 逐题用时累计(SPEC §8 学情「每题中位用时」)。
//
// 纯状态机,不碰 DOM、不碰时钟:调用方把 now 传进来。这样它能被表驱动测试,
// 也不会因为学生改手机时间而算出负数(只用单调差值 + 上限)。
//
// 口径(写下来是因为它决定了老师看到的数字是什么意思):
//   - 同一时刻只有一道题在计时;切到别的题、页面被切到后台、交卷,都会结束当前这段。
//   - 一段超过 MAX_SEGMENT_MS 的,按 MAX_SEGMENT_MS 计 —— 学生把页面开着去吃饭了,
//     那段时间不该算进「这题花了多久」。
//   - 每题累计上限 MAX_ITEM_MS,防异常值把中位数之外的统计(比如平均)带偏。
//   - 埋点是尽力而为:丢了就是丢了,绝不能因此挡住作答(硬约束 7)。

/** 单段上限:超过就认为人不在,按 3 分钟计。 */
export const MAX_SEGMENT_MS = 3 * 60_000
/** 单题累计上限:30 分钟。 */
export const MAX_ITEM_MS = 30 * 60_000

export interface TimerState {
  /** 正在计时的小题;null = 没有 */
  activeItemId: string | null
  /** 当前这段的起点(调用方给的 now) */
  startedAt: number | null
  /** itemId → 累计毫秒 */
  totals: Record<string, number>
}

export function createTimerState(totals: Record<string, number> = {}): TimerState {
  return { activeItemId: null, startedAt: null, totals: { ...totals } }
}

/** 结束当前这段并累计。返回被更新的 itemId(没有在计时则返回 null)。 */
export function stop(state: TimerState, now: number): string | null {
  const { activeItemId, startedAt } = state
  state.activeItemId = null
  state.startedAt = null
  if (!activeItemId || startedAt === null) return null
  const raw = now - startedAt
  if (!Number.isFinite(raw) || raw <= 0) return null // 时钟被改过 / 同一毫秒:不计
  const seg = Math.min(raw, MAX_SEGMENT_MS)
  const prev = state.totals[activeItemId] ?? 0
  state.totals[activeItemId] = Math.min(prev + seg, MAX_ITEM_MS)
  return activeItemId
}

/**
 * 开始给某道题计时(同一道题重复调用不重置;换题会先结束上一段)。
 * 返回因为切换而被累计的那道题(便于调用方落库)。
 */
export function touch(state: TimerState, itemId: string, now: number): string | null {
  if (state.activeItemId === itemId) return null
  const flushed = stop(state, now)
  state.activeItemId = itemId
  state.startedAt = now
  return flushed
}

/** 当前累计(含正在进行的这一段),只读快照。 */
export function snapshot(state: TimerState, now: number): Record<string, number> {
  const out = { ...state.totals }
  if (state.activeItemId && state.startedAt !== null) {
    const raw = now - state.startedAt
    if (Number.isFinite(raw) && raw > 0) {
      out[state.activeItemId] = Math.min((out[state.activeItemId] ?? 0) + Math.min(raw, MAX_SEGMENT_MS), MAX_ITEM_MS)
    }
  }
  return out
}

/** 中位数(毫秒)。空数组返回 null;偶数个取中间两个的平均。 */
export function medianMs(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 === 1 ? xs[mid]! : Math.round((xs[mid - 1]! + xs[mid]!) / 2)
}

/** 给老师看的用时文案:1 分钟以内说秒,超过说「x 分 y 秒」。 */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return rest === 0 ? `${m} 分` : `${m} 分 ${rest} 秒`
}

/**
 * 合并服务端已有与客户端上报的累计用时:取较大者。
 * 客户端发的是累计值,重试与乱序到达都不该让它倒退;两边都没有就是 null。
 */
export function mergeTime(existing: number | null | undefined, incoming: number | null | undefined): number | null {
  const a = typeof existing === 'number' && Number.isFinite(existing) && existing >= 0 ? Math.min(existing, MAX_ITEM_MS) : null
  const b = typeof incoming === 'number' && Number.isFinite(incoming) && incoming >= 0 ? Math.min(incoming, MAX_ITEM_MS) : null
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}
