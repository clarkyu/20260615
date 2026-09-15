import { describe, it, expect } from 'vitest'
import { collectCandidates, mergeAccepted, MAX_ACCEPTED } from '@/lib/bank/candidates'

// accepted 候选(SPEC §8)。这些用例守的是「同一个答案别再送一次 AI」:
// 归并错了,老师采纳完还会冒出同一条;排除错了,采纳过的会再问一次 AI(花钱且可能判得不一样)。

describe('归拢候选', () => {
  it('按规范化形式合并计数,展示取最常见的写法', () => {
    const out = collectCandidates([
      { text: 'has been to', count: 1 },
      { text: 'Has been to', count: 1 },
      { text: 'has  been  to', count: 1 },
      { text: 'have been to', count: 1 },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ normalized: 'has been to', count: 3, text: 'has been to' })
    expect(out[1]).toMatchObject({ normalized: 'have been to', count: 1 })
  })

  it('已在答案键里的不再作为候选(大小写 / 空格 / 弯撇号都算同一个)', () => {
    const rows = [{ text: "It's raining", count: 5 }, { text: 'so tired', count: 2 }]
    expect(collectCandidates(rows, { accepted: ['it’s raining'] }).map((c) => c.normalized)).toEqual(['so tired'])
    expect(collectCandidates(rows, { accepted: ['  SO   TIRED  '] }).map((c) => c.normalized)).toEqual(["it's raining"])
    expect(collectCandidates(rows, { accepted: ["it's raining", 'so tired'] })).toEqual([])
  })

  it('老师拒绝过的不再出现', () => {
    const rows = [{ text: 'good', count: 9 }, { text: 'fine', count: 1 }]
    expect(collectCandidates(rows, { rejected: ['good'] }).map((c) => c.text)).toEqual(['fine'])
  })

  it('空、纯空白、规范化后为空的都丢掉', () => {
    expect(collectCandidates([{ text: '', count: 1 }, { text: '   ', count: 2 }, { text: '...', count: 1 }])).toEqual([])
  })

  it('按出现次数降序;同次数按最近出现;再同就按规范化形式定序(刷新不跳来跳去)', () => {
    const out = collectCandidates([
      { text: 'bbb', count: 2, lastSeenAt: '2026-09-01T00:00:00Z' },
      { text: 'aaa', count: 5, lastSeenAt: '2026-08-01T00:00:00Z' },
      { text: 'ccc', count: 2, lastSeenAt: '2026-09-10T00:00:00Z' },
    ])
    expect(out.map((c) => c.text)).toEqual(['aaa', 'ccc', 'bbb'])
  })

  it('次数非法(0 / 负数 / NaN)按 1 算,不会把候选算没了', () => {
    const out = collectCandidates([{ text: 'x', count: 0 }, { text: 'x', count: -3 }, { text: 'x', count: Number.NaN }])
    expect(out[0]).toMatchObject({ text: 'x', count: 3 })
  })

  it('没有时间戳也能排,不会因为 null 抛错', () => {
    const out = collectCandidates([{ text: 'a', count: 1, lastSeenAt: null }, { text: 'b', count: 1 }])
    expect(out).toHaveLength(2)
    expect(out.every((c) => c.lastSeenAt === null)).toBe(true)
  })
})

describe('并进答案键', () => {
  it('保留原有顺序与写法,新答案按传入顺序追加', () => {
    const r = mergeAccepted(['has been to'], ['have gone to', 'went to'])
    expect(r.accepted).toEqual(['has been to', 'have gone to', 'went to'])
    expect(r.added).toEqual(['have gone to', 'went to'])
  })

  it('规范化后重复的不加(答案键里不留只差大小写的两条)', () => {
    const r = mergeAccepted(['has been to'], ['HAS  BEEN  TO', 'have gone to'])
    expect(r.accepted).toEqual(['has been to', 'have gone to'])
    expect(r.duplicates).toEqual(['HAS  BEEN  TO'])
    expect(r.added).toEqual(['have gone to'])
  })

  it('同一批里的重复也只进一条', () => {
    const r = mergeAccepted([], ['a lot of', 'A LOT OF', 'lots of'])
    expect(r.accepted).toEqual(['a lot of', 'lots of'])
    expect(r.duplicates).toEqual(['A LOT OF'])
  })

  it('超过上限的不再加,并如实报告', () => {
    const existing = Array.from({ length: MAX_ACCEPTED }, (_, i) => `ans${i}`)
    const r = mergeAccepted(existing, ['new one'])
    expect(r.accepted).toHaveLength(MAX_ACCEPTED)
    expect(r.added).toEqual([])
    expect(r.overflow).toEqual(['new one'])
  })

  it('空字符串与纯空白直接忽略,不会写进答案键', () => {
    const r = mergeAccepted(['x'], ['', '   ', 'y'])
    expect(r.accepted).toEqual(['x', 'y'])
    expect(r.added).toEqual(['y'])
  })

  it('不改传入的数组(调用方还要用原值比对)', () => {
    const existing = ['a']
    const r = mergeAccepted(existing, ['b'])
    expect(existing).toEqual(['a'])
    expect(r.accepted).not.toBe(existing)
  })

  it('采纳完再收一次同样的候选,应该一条都不剩', () => {
    // 这就是这个功能要解决的问题:采纳后不能再冒出来,否则还会送 AI。
    const rows = [{ text: 'have gone to', count: 3 }]
    const merged = mergeAccepted(['has been to'], rows.map((r) => r.text))
    expect(collectCandidates(rows, { accepted: merged.accepted })).toEqual([])
  })
})
