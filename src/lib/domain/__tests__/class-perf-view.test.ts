// 雨课堂原始数据透出:钉版解析(损坏容错)、逐生汇总口径(只数计次节/分母随功能开放)、
// 学生端每课头择版(钉住优先、否则最新)。全部纯函数,零 prisma。
import { describe, expect, it } from 'vitest'
import type { RainSession } from '@/lib/rain-classroom'
import { CLASSPERF_LENIENT_WEIGHTS } from '../class-perf'
import { buildStudentRow, parseWeights, pickRowPerOffering, pinnedImportId } from '../class-perf-view'

const sess = (over: Partial<RainSession> = {}): RainSession => ({
  label: 's',
  date: null,
  counted: true,
  danmakuOpen: false,
  postOpen: false,
  questions: 0,
  ...over,
})

describe('pinnedImportId / parseWeights', () => {
  it('从配置 JSON 取钉住 id;缺失/损坏/非整数一律 null', () => {
    expect(pinnedImportId(JSON.stringify({ categories: { classroom: { classPerfImportId: 7 } } }))).toBe(7)
    expect(pinnedImportId(JSON.stringify({ categories: { classroom: { classPerfImportId: null } } }))).toBeNull()
    expect(pinnedImportId('{broken')).toBeNull()
    expect(pinnedImportId(null)).toBeNull()
  })

  it('权重损坏回默认;部分字段与默认合并', () => {
    expect(parseWeights('{broken')).toMatchObject({ attendance: 50 })
    expect(parseWeights(JSON.stringify(CLASSPERF_LENIENT_WEIGHTS)).attendance).toBe(70)
  })
})

describe('buildStudentRow', () => {
  it('汇总只数计次节;答题分母只数有题的节;分数与公式 B 一致', () => {
    const sessions = [
      sess({ danmakuOpen: true, postOpen: true, questions: 2 }),
      sess({ questions: 1 }),
      sess({ counted: false, danmakuOpen: true }), // 重开课:任何信号都不计
    ]
    const detail = [
      { attended: true, danmaku: 3, posts: 1, answered: true },
      { attended: false, danmaku: 0, posts: 0, answered: true },
      { attended: true, danmaku: 9, posts: 9, answered: true },
    ]
    const row = buildStudentRow('80250001', '甲', true, detail, sessions, CLASSPERF_LENIENT_WEIGHTS)
    expect(row).toMatchObject({
      attended: 1,
      countedSessions: 2,
      danmaku: 3, // 不计次节的 9 条不算
      posts: 1,
      answeredSessions: 2,
      questionSessions: 2,
    })
    // 公式 B:到课 1/2×70 + 弹幕 1/1×10 + 投稿 1/1×10 + 答题 2/2×10 = 65
    expect(row.score).toBe(65)
  })

  it('明细行缺失按零参与补齐,不抛错', () => {
    const row = buildStudentRow('80250002', '乙', false, [], [sess()], CLASSPERF_LENIENT_WEIGHTS)
    expect(row.attended).toBe(0)
    expect(row.score).toBe(0)
    expect(row.matched).toBe(false)
  })
})

describe('pickRowPerOffering', () => {
  const mk = (importId: number, offeringId: number) =>
    ({ import: { id: importId, offeringId } }) as Parameters<typeof pickRowPerOffering>[0][number]

  it('无钉版取最新;有钉版取钉住那次;钉版失踪回落最新', () => {
    const rows = [mk(1, 9), mk(2, 9), mk(5, 10), mk(6, 10)]
    const noPin = pickRowPerOffering(rows, new Map())
    expect(noPin.map((r) => r.import.id).sort()).toEqual([2, 6])

    const pinned = pickRowPerOffering(rows, new Map([[9, 1]]))
    expect(pinned.find((r) => r.import.offeringId === 9)?.import.id).toBe(1)
    expect(pinned.find((r) => r.import.offeringId === 10)?.import.id).toBe(6)

    const gone = pickRowPerOffering(rows, new Map([[9, 999]]))
    expect(gone.find((r) => r.import.offeringId === 9)?.import.id).toBe(2)
  })
})
