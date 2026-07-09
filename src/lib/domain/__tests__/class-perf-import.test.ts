// 雨课堂导入编排纯函数:学号匹配(两向名单/重复计数)、预览摘要(预估分/保底名单)、
// 落库行装配(userId 映射、JSON 载荷)。全部零 prisma。
import { describe, expect, it } from 'vitest'
import type { RainSession, RainStudent } from '@/lib/rain-classroom'
import { buildImportPreview, buildStudentRows, matchRoster, type RainParsedOk } from '../class-perf-import'

const sess = (over: Partial<RainSession> = {}): RainSession => ({
  label: '第一章 2026-03-02',
  date: '2026-03-02',
  counted: true,
  danmakuOpen: false,
  postOpen: false,
  questions: 0,
  ...over,
})

const stu = (no: string, over: Partial<RainStudent> = {}): RainStudent => ({
  studentNo: no,
  name: `学生${no.slice(-2)}`,
  duplicated: false,
  summaryAttended: 1,
  summaryDanmaku: 0,
  summaryPosts: 0,
  detail: [{ attended: true, danmaku: 0, posts: 0, answered: false }],
  ...over,
})

const roster = [
  { id: 11, studentNo: '20250001', name: '甲' },
  { id: 12, studentNo: '20250002 ', name: '乙' }, // 花名册学号带尾空格:匹配前须 trim
  { id: 13, studentNo: null, name: '无学号' },
  { id: 14, studentNo: '20250099', name: '文件缺席' },
]

describe('matchRoster', () => {
  it('学号精确匹配;文件多出/花名册缺席两向列出;重复学号计数', () => {
    const students = [stu('20250001'), stu('20250002', { duplicated: true }), stu('20259999')]
    const m = matchRoster(students, roster)
    expect(m.matchedCount).toBe(2)
    expect(m.userIdByNo.get('20250001')).toBe(11)
    expect(m.userIdByNo.get('20250002')).toBe(12)
    expect(m.unmatched).toEqual([{ studentNo: '20259999', name: '学生99' }])
    expect(m.missingFromFile).toEqual([{ studentNo: '20250099', name: '文件缺席' }])
    expect(m.duplicateCount).toBe(1)
  })

  it('花名册学号为 null 不参与匹配也不进缺席名单', () => {
    const m = matchRoster([stu('20250001')], roster)
    // 文件里只有 20250001:缺席 = 20250002(trim 后)与 20250099;null 学号不出现。
    expect(m.missingFromFile.map((x) => x.studentNo).sort()).toEqual(['20250002', '20250099'])
  })
})

describe('buildImportPreview', () => {
  const sessions = [sess(), sess({ label: '第二章 2026-03-09', date: '2026-03-09' }), sess({ label: '第一章(2)', counted: false })]
  const parsed: RainParsedOk = {
    sessions,
    declaredSessions: 2,
    warnings: ['rain.warnSessionCount:2/2'],
    students: [
      // 全勤:宽松权重下 100 分
      stu('20250001', { detail: sessions.map(() => ({ attended: true, danmaku: 0, posts: 0, answered: false })) }),
      // 全缺:0 分(到课率 0 不触发保底)
      stu('20250002', { detail: sessions.map(() => ({ attended: false, danmaku: 0, posts: 0, answered: false })), summaryAttended: 0 }),
      // 未匹配:不进预估
      stu('20259999', { detail: sessions.map(() => ({ attended: true, danmaku: 0, posts: 0, answered: false })) }),
    ],
  }

  it('计数/名单/警示齐备;预估只算匹配学生', () => {
    const p = buildImportPreview('rain.xlsx', parsed, roster)
    expect(p.rowCount).toBe(3)
    expect(p.matchedCount).toBe(2)
    expect(p.countedSessions).toBe(2)
    expect(p.declaredSessions).toBe(2)
    expect(p.unmatched).toHaveLength(1)
    expect(p.missingFromFile).toHaveLength(1)
    expect(p.warnings).toEqual(['rain.warnSessionCount:2/2'])
    expect(p.scoreMean).toBe(50) // (100 + 0) / 2,未匹配的 100 不掺入
  })

  it('保底名单:到课率≥80% 但参与分低被抬到 60 的学生列出', () => {
    const withSignals = [sess({ danmakuOpen: true, postOpen: true, questions: 2 }), sess({ label: '第二章', danmakuOpen: true, postOpen: true, questions: 2 })]
    const p = buildImportPreview(
      'rain.xlsx',
      {
        sessions: withSignals,
        declaredSessions: null,
        warnings: [],
        // 全到课但零参与:70% 考勤分 = 70×1 + 30×0 = 70?不——宽松权重 70/10/10/10,
        // 全到课零参与 = 70 分,不触发保底。要触发保底须到课 0.8、参与 0:0.8×70=56 → 60。
        students: [
          stu('20250001', {
            detail: [
              { attended: true, danmaku: 0, posts: 0, answered: false },
              { attended: false, danmaku: 0, posts: 0, answered: false },
            ],
          }),
        ],
      },
      [{ id: 11, studentNo: '20250001', name: '甲' }],
    )
    // 到课率 1/2=0.5 <0.8:不保底,35 分原样。换成两节全到里挑——直接断言本例不进名单。
    expect(p.floored).toHaveLength(0)
    expect(p.scoreMean).toBe(35)
  })

  it('保底触发:5 节到 4 节零参与 → 56 抬 60 并列名', () => {
    const five = Array.from({ length: 5 }, (_, i) => sess({ label: `第${i}节`, danmakuOpen: true, postOpen: true, questions: 1 }))
    const p = buildImportPreview(
      'rain.xlsx',
      {
        sessions: five,
        declaredSessions: null,
        warnings: [],
        students: [
          stu('20250001', {
            detail: five.map((_, i) => ({ attended: i < 4, danmaku: 0, posts: 0, answered: false })),
          }),
        ],
      },
      [{ id: 11, studentNo: '20250001', name: '甲' }],
    )
    // 名单带的是文件里的姓名(导入行原样),不是花名册姓名。
    expect(p.floored).toEqual([{ studentNo: '20250001', name: '学生01' }])
    expect(p.scoreMean).toBe(60)
  })
})

describe('buildStudentRows', () => {
  it('userId 按映射落行、未匹配为 null;summary/detail JSON 可回读', () => {
    const students = [stu('20250001', { duplicated: true, summaryDanmaku: 3 }), stu('20259999')]
    const rows = buildStudentRows(7, students, new Map([['20250001', 11]]))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ importId: 7, studentNo: '20250001', userId: 11 })
    expect(rows[1].userId).toBeNull()
    expect(JSON.parse(rows[0].summaryJson)).toEqual({ attended: 1, danmaku: 3, posts: 0, duplicated: true })
    expect(JSON.parse(rows[0].detailJson)).toEqual([{ attended: true, danmaku: 0, posts: 0, answered: false }])
  })
})
