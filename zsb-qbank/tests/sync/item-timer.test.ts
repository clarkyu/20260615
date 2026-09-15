import { describe, it, expect } from 'vitest'
import { createTimerState, fmtDuration, medianMs, mergeTime, MAX_ITEM_MS, MAX_SEGMENT_MS, snapshot, stop, touch } from '@/lib/sync/item-timer'

// 逐题计时(SPEC §8 中位用时)。这些用例钉的是「老师看到的数字是什么意思」:
// 人走开了不算、时钟被改了不算负数、切题不丢段、交卷前的那一段要算进去。

describe('累计', () => {
  it('切到一题 → 切走,这一段被累计', () => {
    const t = createTimerState()
    touch(t, 'a', 1000)
    touch(t, 'b', 4000)
    expect(t.totals).toEqual({ a: 3000 })
    stop(t, 5000)
    expect(t.totals).toEqual({ a: 3000, b: 1000 })
  })

  it('同一题重复 touch 不重置,也不重复计', () => {
    const t = createTimerState()
    touch(t, 'a', 0)
    touch(t, 'a', 500)
    touch(t, 'a', 900)
    stop(t, 1000)
    expect(t.totals).toEqual({ a: 1000 })
  })

  it('来回切换,同一题的多段相加', () => {
    const t = createTimerState()
    touch(t, 'a', 0)
    touch(t, 'b', 1000) // a += 1000
    touch(t, 'a', 3000) // b += 2000
    stop(t, 3500) // a += 500
    expect(t.totals).toEqual({ a: 1500, b: 2000 })
  })

  it('单段超过上限按上限计(人把页面开着走开了)', () => {
    const t = createTimerState()
    touch(t, 'a', 0)
    stop(t, 60 * 60_000) // 一小时
    expect(t.totals.a).toBe(MAX_SEGMENT_MS)
  })

  it('单题累计封顶', () => {
    const t = createTimerState()
    for (let i = 0; i < 20; i++) {
      touch(t, 'a', i * 2 * MAX_SEGMENT_MS)
      stop(t, i * 2 * MAX_SEGMENT_MS + MAX_SEGMENT_MS)
    }
    expect(t.totals.a).toBe(MAX_ITEM_MS)
  })

  it('时钟倒退 / 同一毫秒不产生负数或 0 段', () => {
    const t = createTimerState()
    touch(t, 'a', 10_000)
    stop(t, 5_000) // 学生把手机时间调回去了
    expect(t.totals.a).toBeUndefined()
    touch(t, 'b', 1000)
    stop(t, 1000)
    expect(t.totals.b).toBeUndefined()
  })

  it('没在计时的时候 stop 是空操作', () => {
    const t = createTimerState()
    expect(stop(t, 1000)).toBeNull()
    expect(t.totals).toEqual({})
  })

  it('用已有累计打底(重开页面继续算)', () => {
    const t = createTimerState({ a: 5000 })
    touch(t, 'a', 0)
    stop(t, 1000)
    expect(t.totals.a).toBe(6000)
  })

  it('stop / touch 返回被结算的那道题,调用方据此落库', () => {
    const t = createTimerState()
    expect(touch(t, 'a', 0)).toBeNull() // 之前没有在计时
    expect(touch(t, 'b', 100)).toBe('a')
    expect(stop(t, 200)).toBe('b')
  })
})

describe('快照', () => {
  it('包含正在进行的这一段,且不改状态', () => {
    const t = createTimerState({ a: 1000 })
    touch(t, 'a', 0)
    expect(snapshot(t, 500).a).toBe(1500)
    expect(t.totals.a).toBe(1000) // 没有被写进去
    expect(t.activeItemId).toBe('a')
  })
  it('没有在计时时就是当前累计', () => {
    const t = createTimerState({ a: 1000 })
    expect(snapshot(t, 999_999)).toEqual({ a: 1000 })
  })
})

describe('中位数', () => {
  it.each([
    [[], null],
    [[5000], 5000],
    [[1000, 3000], 2000],
    [[3000, 1000, 2000], 2000],
    [[4000, 1000, 3000, 2000], 2500],
  ])('%s → %s', (xs, want) => {
    expect(medianMs(xs as number[])).toBe(want)
  })
  it('忽略非法值,不因此算错', () => {
    expect(medianMs([1000, Number.NaN, -5, 3000])).toBe(2000)
  })
})

describe('用时文案', () => {
  it.each([
    [null, '—'],
    [undefined, '—'],
    [0, '0 秒'],
    [999, '1 秒'],
    [45_000, '45 秒'],
    [60_000, '1 分'],
    [95_000, '1 分 35 秒'],
    [-1, '—'],
  ])('%s → %s', (ms, want) => {
    expect(fmtDuration(ms as number | null | undefined)).toBe(want)
  })
})

describe('服务端合并累计用时', () => {
  it.each([
    ['两边都有:取大', 10_000, 3_000, 10_000],
    ['客户端更大:用新的', 3_000, 10_000, 10_000],
    ['服务端没有:用客户端的', null, 8_000, 8_000],
    ['客户端没报:保留服务端的', 8_000, undefined, 8_000],
    ['两边都没有:null', null, null, null],
    ['负数视为没有', 5_000, -1, 5_000],
    ['超上限的夹到上限', null, MAX_ITEM_MS + 999, MAX_ITEM_MS],
  ])('%s', (_name, a, b, want) => {
    expect(mergeTime(a as number | null, b as number | null | undefined)).toBe(want)
  })
})
