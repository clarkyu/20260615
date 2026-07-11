// 雨课堂导入编排:姓名优先匹配(以系统名单为准)、资料修正、同人多行合并、
// 同名消歧/不猜、落库行装配(系统身份 + sources 备审、未匹配隔离)。全部纯函数,零 prisma。
import { describe, expect, it } from 'vitest'
import type { RainSession, RainStudent } from '@/lib/rain-classroom'
import {
  buildImportPreview,
  buildStudentRows,
  buildUnmatchedRows,
  matchRoster,
  mergeDetails,
  normName,
  normNo,
  type RainParsedOk,
} from '../class-perf-import'

const sess = (over: Partial<RainSession> = {}): RainSession => ({
  label: '第一章 2026-03-02',
  date: '2026-03-02',
  counted: true,
  danmakuOpen: false,
  postOpen: false,
  questions: 0,
  ...over,
})

const stu = (no: string, name: string, over: Partial<RainStudent> = {}): RainStudent => ({
  studentNo: no,
  name,
  duplicated: false,
  summaryAttended: 1,
  summaryDanmaku: 0,
  summaryPosts: 0,
  detail: [{ attended: true, danmaku: 0, posts: 0, answered: false }],
  ...over,
})

const roster = [
  { id: 11, studentNo: '80250001', name: '李云翔' },
  { id: 12, studentNo: '80250002', name: '吾麦尔江·阿力木' },
  { id: 13, studentNo: '80250003', name: '张伟' },
  { id: 14, studentNo: '80250004', name: '张伟' }, // 与 13 同名:必须靠学号消歧
  { id: 15, studentNo: '80250005', name: '王芳' },
]

describe('normName / normNo(修正不规范资料的比较基准)', () => {
  it('去空白/零宽、全角转半角、间隔号统一、拉丁小写', () => {
    expect(normName(' 李 云　翔 ')).toBe('李云翔')
    expect(normName('吾麦尔江.阿力木')).toBe('吾麦尔江·阿力木')
    expect(normName('吾麦尔江・阿力木')).toBe('吾麦尔江·阿力木')
    expect(normName('Ｔｏｍ Ｌｅｅ')).toBe('tomlee')
    expect(normNo('８０２５０００１ ')).toBe('80250001')
    expect(normNo('8025 0001')).toBe('80250001')
  })
})

describe('matchRoster(姓名优先,以系统名单为准)', () => {
  it('姓名唯一命中:学号错也归入并记修正(via=name)', () => {
    const m = matchRoster([stu('2025101326', '李云翔')], roster)
    expect(m.matched).toHaveLength(1)
    expect(m.matched[0]).toMatchObject({ userId: 11, studentNo: '80250001', name: '李云翔', via: 'name' })
    expect(m.corrections).toEqual([
      { fromNo: '2025101326', fromName: '李云翔', toNo: '80250001', toName: '李云翔', via: 'name' },
    ])
    expect(m.unmatched).toHaveLength(0)
  })

  it('姓名带脏字符(空格/间隔号变体)也能命中并修正姓名', () => {
    const m = matchRoster([stu('80250002', '吾麦尔江.阿力木')], roster)
    expect(m.matched[0]).toMatchObject({ userId: 12, name: '吾麦尔江·阿力木' })
    expect(m.corrections).toHaveLength(1) // 姓名原文 ≠ 系统原文 → 记修正
  })

  it('同名多人:学号能消歧则 via=name+no;消不了不猜 → 未匹配 + 聚合警示', () => {
    const ok = matchRoster([stu('80250004', '张伟')], roster)
    expect(ok.matched[0]).toMatchObject({ userId: 14, via: 'name+no' })

    const amb = matchRoster([stu('999', '张伟')], roster)
    expect(amb.matched).toHaveLength(0)
    expect(amb.unmatched).toEqual([{ studentNo: '999', name: '张伟' }])
    expect(amb.warnings).toContain('rain.warnDupName:1')
  })

  it('姓名无命中:学号精确兜底(via=no),姓名修正为系统原文', () => {
    const m = matchRoster([stu('80250005', '王'), stu('88888888', '陌生人')], roster)
    expect(m.matched[0]).toMatchObject({ userId: 15, name: '王芳', via: 'no' })
    expect(m.unmatched).toEqual([{ studentNo: '88888888', name: '陌生人' }])
  })

  it('花名册规范化后撞号(遗留脏数据):学号通道作废不猜 → 未匹配 + 聚合警示', () => {
    const twinRoster = [
      { id: 21, studentNo: '90250001', name: '甲一' },
      { id: 22, studentNo: '9025 0001', name: '乙二' }, // 内部空格:normNo 后与 21 撞
    ]
    const m = matchRoster([stu('90250001', '丙三')], twinRoster) // 姓名无命中,只能靠学号
    expect(m.matched).toHaveLength(0)
    expect(m.unmatched).toEqual([{ studentNo: '90250001', name: '丙三' }])
    expect(m.warnings).toContain('rain.warnDupNo:1')
    // 顺序无关:花名册反转结果一致(不猜=确定性)
    const m2 = matchRoster([stu('90250001', '丙三')], [...twinRoster].reverse())
    expect(m2.matched).toHaveLength(0)
  })

  it('trim 后同号的两个系统学生都被姓名匹配:保 userId 小者,其余退回未匹配(防落库撞键)', () => {
    const twinRoster = [
      { id: 21, studentNo: '90250001', name: '甲一' },
      { id: 22, studentNo: '90250001 ', name: '乙二' }, // trim 后同号(遗留脏数据)
    ]
    const m = matchRoster([stu('111', '甲一'), stu('222', '乙二')], twinRoster)
    expect(m.matched).toHaveLength(1)
    expect(m.matched[0].userId).toBe(21)
    expect(m.unmatched).toEqual([{ studentNo: '222', name: '乙二' }])
    expect(m.warnings).toContain('rain.warnDupNo:1')
    // 退回的行不留在修正名单里(名单与实际落库一致)
    expect(m.corrections.every((c) => c.fromNo !== '222')).toBe(true)
  })

  it('花名册学号为 null/空:不参与任何匹配(含姓名),也不进缺席名单', () => {
    const withNull = [...roster, { id: 99, studentNo: null, name: '李云翔' }] // 与 11 同名但无学号
    const m = matchRoster([stu('2025100001', '李云翔')], withNull)
    // 若 99 参与姓名匹配会变同名多人 → 未匹配;排除后仍唯一命中 11
    expect(m.matched[0]?.userId).toBe(11)
    expect(m.missingFromFile.map((x) => x.name)).not.toContain('')
    expect(m.missingFromFile.every((x) => x.studentNo !== '')).toBe(true)
  })

  it('姓名与学号指向不同学生:按姓名归入(clark 口径)+ 聚合警示', () => {
    // 名=李云翔(11),号=80250005(15) → 归 11,警示 1 条
    const m = matchRoster([stu('80250005', '李云翔')], roster)
    expect(m.matched[0].userId).toBe(11)
    expect(m.warnings).toContain('rain.warnNoConflict:1')
  })

  it('同一学生多行合并:到课 OR、条数 SUM、答题 OR;merges 列出;缺席名单不含已归入者', () => {
    const a = stu('80250001', '李云翔', {
      detail: [
        { attended: true, danmaku: 2, posts: 0, answered: false },
        { attended: false, danmaku: 0, posts: 0, answered: false },
      ],
      summaryAttended: 1,
      summaryDanmaku: 2,
    })
    const b = stu('2025109999', '李 云翔', {
      detail: [
        { attended: false, danmaku: 1, posts: 1, answered: true },
        { attended: true, danmaku: 0, posts: 0, answered: false },
      ],
      summaryAttended: 1,
      summaryDanmaku: 1,
      summaryPosts: 1,
    })
    const m = matchRoster([a, b], roster)
    expect(m.matched).toHaveLength(1)
    expect(m.matched[0].detail).toEqual([
      { attended: true, danmaku: 3, posts: 1, answered: true },
      { attended: true, danmaku: 0, posts: 0, answered: false },
    ])
    expect(m.matched[0]).toMatchObject({ summaryAttended: 2, summaryDanmaku: 3, summaryPosts: 1 })
    expect(m.merges).toEqual([{ studentNo: '80250001', name: '李云翔', rows: 2 }])
    expect(m.missingFromFile.map((x) => x.studentNo)).not.toContain('80250001')
  })
})

describe('mergeDetails', () => {
  it('长度不齐按零参与补齐', () => {
    const out = mergeDetails([{ attended: true, danmaku: 1, posts: 0, answered: false }], [])
    expect(out).toEqual([{ attended: true, danmaku: 1, posts: 0, answered: false }])
  })
})

describe('buildImportPreview / 落库行装配', () => {
  const sessions = [sess({ danmakuOpen: true, postOpen: true, questions: 1 })]
  const parsed: RainParsedOk = {
    sessions,
    declaredSessions: 1,
    warnings: [],
    students: [
      stu('2025100001', '李云翔'), // 姓名归入 + 学号修正
      stu('80250003', '张伟'), // 同名靠学号消歧
      stu('88888888', '陌生人'), // 未匹配
    ],
  }

  it('预览带修正/合并/两向名单;预估分只算匹配学生(合并后),未匹配不掺入', () => {
    const p = buildImportPreview('rain.xlsx', parsed, roster)
    expect(p).toMatchObject({ rowCount: 3, matchedCount: 2 })
    expect(p.corrections).toHaveLength(1)
    expect(p.unmatched).toEqual([{ studentNo: '88888888', name: '陌生人' }])
    expect(p.missingFromFile.map((x) => x.studentNo).sort()).toEqual(['80250002', '80250004', '80250005'])
    // 两个匹配学生:全到课 + 弹幕/投稿/答题全零参与 → 各 70 分(宽松权重),均分恰 70;
    // 未匹配「陌生人」若被掺入也是 70,故再用 3 人场景钉死人数口径 ↓
    expect(p.scoreMean).toBe(70)
    const absent = { attended: false, danmaku: 0, posts: 0, answered: false }
    const withAbsent: RainParsedOk = { ...parsed, students: [...parsed.students.slice(0, 2), stu('88888888', '陌生人', { detail: [absent] })] }
    const p2 = buildImportPreview('rain.xlsx', withAbsent, roster)
    expect(p2.scoreMean).toBe(70) // 未匹配 0 分若掺入会拉到 46.7 → 仍 70 证明未掺入
  })

  it('匹配层警示透传到预览 warnings(与解析警示合并)', () => {
    const amb: RainParsedOk = {
      sessions,
      declaredSessions: 1,
      warnings: ['rain.warnSessionCount:1/2'],
      students: [stu('999', '张伟')], // 同名多人、学号消歧不了
    }
    const p = buildImportPreview('rain.xlsx', amb, roster)
    expect(p.warnings).toContain('rain.warnSessionCount:1/2')
    expect(p.warnings).toContain('rain.warnDupName:1')
  })

  it('落库:匹配行写系统身份 + sources 备审;未匹配行原样、撞系统学号加「!」隔离', () => {
    const m = matchRoster(parsed.students, roster)
    const rows = buildStudentRows(7, m)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ importId: 7, studentNo: '80250001', userId: 11, name: '李云翔' })
    expect(JSON.parse(rows[0].summaryJson)).toMatchObject({
      via: 'name',
      merged: false,
      sources: [{ studentNo: '2025100001', name: '李云翔' }],
    })

    const un = buildUnmatchedRows(7, parsed.students, m)
    expect(un).toHaveLength(1)
    expect(un[0]).toMatchObject({ studentNo: '88888888', userId: null })
    expect(JSON.parse(un[0].summaryJson)).toMatchObject({ unmatched: true })

    // 学号兜底也会把「学号对、姓名不在册」的行归入(常见:学生用昵称注册)——
    // 修正名单会显示 fromName → toName,老师预览可辨。
    const nick: RainParsedOk = {
      sessions,
      declaredSessions: 1,
      warnings: [],
      students: [stu('2025100001', '李云翔'), stu('80250001', '小李同学')],
    }
    const m2 = matchRoster(nick.students, roster)
    expect(m2.matched).toHaveLength(1)
    expect(m2.merges).toHaveLength(1)
    expect(m2.corrections.map((c) => c.fromName).sort()).toEqual(['小李同学', '李云翔'])
  })

  it('撞号隔离:未匹配行学号恰与某匹配行的系统学号相同 → 加「!」前缀防唯一键冲突', () => {
    // '80250001 张伟':同名多人(13/14)、学号对不上任何一个 → 未匹配;
    // '2025100001 李云翔':按姓名归入 → 系统学号 80250001 与上面未匹配行原学号相同。
    const clash: RainParsedOk = {
      sessions: [sess()],
      declaredSessions: 1,
      warnings: [],
      students: [stu('2025100001', '李云翔'), stu('80250001', '张伟')],
    }
    const m = matchRoster(clash.students, roster)
    expect(m.matched.map((x) => x.studentNo)).toEqual(['80250001'])
    expect(m.unmatched).toEqual([{ studentNo: '80250001', name: '张伟' }])
    const un = buildUnmatchedRows(9, clash.students, m)
    expect(un).toHaveLength(1)
    expect(un[0].studentNo).toBe('!80250001')
  })
})
