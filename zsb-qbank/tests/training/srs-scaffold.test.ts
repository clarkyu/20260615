import { describe, it, expect } from 'vitest'
import { DAY_MS, intervalForStreak, isMastered, nextReview, startOfDayShanghai, type ReviewCardState } from '@/lib/training/srs'
import { INITIAL_SCAFFOLD, maskWord, nextScaffold, scaffoldHint, type ScaffoldState } from '@/lib/training/scaffold'

// M6 纯函数:间隔复习阶梯与三级脚手架升降(SPEC §6 / §10 M6)。

const now = new Date('2026-09-14T10:00:00Z')
const days = (d: Date, from = now) => Math.round((d.getTime() - from.getTime()) / DAY_MS)

describe('间隔复习', () => {
  it.each([
    [1, 1],
    [2, 3],
    [3, 7],
    [4, 14],
    [5, 30],
    [6, 30],
    [0, 1],
  ])('连对 %s 次 → %s 天', (streak, d) => {
    expect(intervalForStreak(streak)).toBe(d)
  })
  it('答对不建卡;答错建卡,次日到期(错题次日出现在今日复习)', () => {
    expect(nextReview(null, true, now)).toBeNull()
    const c = nextReview(null, false, now)!
    expect(days(c.dueAt)).toBe(1)
    expect(c).toMatchObject({ intervalDays: 1, streak: 0, lapses: 1, lastResult: 'wrong' })
  })
  it('已有卡:连对沿 1/3/7/14/30 阶梯,答错重置到 1 天并记遗忘', () => {
    let c: ReviewCardState = nextReview(null, false, now)!
    const seen: number[] = []
    for (let i = 0; i < 6; i++) {
      c = nextReview(c, true, now)!
      seen.push(c.intervalDays)
    }
    expect(seen).toEqual([1, 3, 7, 14, 30, 30])
    expect(isMastered(c)).toBe(true)
    const w = nextReview(c, false, now)!
    expect(w).toMatchObject({ streak: 0, lapses: 2, intervalDays: 1, lastResult: 'wrong' })
    expect(days(w.dueAt)).toBe(1)
    expect(isMastered(w)).toBe(false)
  })
  it('北京时间日界', () => {
    // 2026-09-14 10:00Z = 北京 18:00 → 当天 0 点 = 2026-09-13T16:00Z
    expect(startOfDayShanghai(now).toISOString()).toBe('2026-09-13T16:00:00.000Z')
    // 2026-09-14 17:00Z = 北京 15 日 01:00 → 14T16:00Z
    expect(startOfDayShanghai(new Date('2026-09-14T17:00:00Z')).toISOString()).toBe('2026-09-14T16:00:00.000Z')
  })
})

describe('三级脚手架', () => {
  it('答对升级、答错降级,三级连对两次永久关闭', () => {
    let s: ScaffoldState = INITIAL_SCAFFOLD
    s = nextScaffold(s, true)
    expect(s).toEqual({ level: 2, l3Streak: 0, off: false })
    s = nextScaffold(s, false)
    expect(s).toEqual({ level: 1, l3Streak: 0, off: false })
    s = nextScaffold(nextScaffold(s, true), true)
    expect(s.level).toBe(3)
    s = nextScaffold(s, true)
    expect(s).toEqual({ level: 3, l3Streak: 1, off: false })
    s = nextScaffold(s, false)
    expect(s).toEqual({ level: 2, l3Streak: 0, off: false })
    s = nextScaffold(nextScaffold(nextScaffold(s, true), true), true)
    expect(s).toEqual({ level: 3, l3Streak: 2, off: true })
    // 关闭后不再变动
    expect(nextScaffold(s, false)).toEqual({ level: 3, l3Streak: 2, off: true })
  })
  it('一级出四个词块且含答案、顺序稳定;没有干扰项退化为二级', () => {
    const h = scaffoldHint(INITIAL_SCAFFOLD, 'biggest', ['big', 'bigger', 'bigness', 'extra'], 'item-1')
    expect(h.level).toBe(1)
    expect(h.options).toHaveLength(4)
    expect(h.options).toContain('biggest')
    expect(h.options).toEqual(scaffoldHint(INITIAL_SCAFFOLD, 'biggest', ['big', 'bigger', 'bigness', 'extra'], 'item-1').options)
    expect(scaffoldHint(INITIAL_SCAFFOLD, 'biggest', ['biggest', 'x'], 'item-1')).toMatchObject({ level: 2, mask: 'b _ _ _ _ _ _' })
    expect(scaffoldHint(INITIAL_SCAFFOLD, 'biggest', undefined, 'item-1')).toMatchObject({ level: 2 })
  })
  it('二级掩码:首字母 + 字母数;多词逐词;关闭后无提示', () => {
    expect(maskWord('it snows')).toBe('i _   s _ _ _ _')
    expect(maskWord("don't")).toBe("d _ _ ' _")
    expect(maskWord('a')).toBe('_')
    expect(scaffoldHint({ level: 2, l3Streak: 0, off: false }, 'quiet', [], 's').mask).toBe('q _ _ _ _')
    expect(scaffoldHint({ level: 3, l3Streak: 2, off: true }, 'quiet', ['a', 'b', 'c'], 's')).toEqual({ level: 3, off: true })
    expect(scaffoldHint({ level: 3, l3Streak: 0, off: false }, 'quiet', [], 's')).toEqual({ level: 3, off: false })
  })
})
