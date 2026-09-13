// 进程内滑动窗口限速(SPEC §9.5:写接口按用户限速)。单进程部署足够;多实例时各自计数,
// 上限相应放宽即可。key 由调用方拼(如 `check:${userId}`),不含学生内容。

const buckets = new Map<string, number[]>()
const MAX_KEYS = 10_000

/** 返回 true 表示放行并计数;false 表示超限(调用方回 429)。 */
export function rateLimit(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  const kept = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (kept.length >= limit) {
    buckets.set(key, kept)
    return false
  }
  kept.push(now)
  buckets.set(key, kept)
  if (buckets.size > MAX_KEYS) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k)
  }
  return true
}

export function resetRateLimits(): void {
  buckets.clear()
}
