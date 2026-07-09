import { describe, it, expect } from 'vitest'
import { buildSnapshot, publishBlocker, extractStudentView, fillSixtyTargets } from '../review-publish'
import { defaultReviewConfig } from '../review'
import type { WorkbenchData } from '../review-load'

const data = (over: Partial<WorkbenchData> = {}): WorkbenchData => ({
  config: defaultReviewConfig(
    [
      { id: 1, title: 'Native English 2000：五月', mode: null },
      { id: 2, title: 'Native English 2000：六月', mode: null },
      { id: 3, title: '期末考核：2025-2026-2', mode: null },
    ],
    9,
  ),
  configVersion: 1,
  students: [
    { id: 101, no: '01', name: '甲', inputs: { classroom: 80, trainingParts: [90, 70], final: 75 }, overrides: [] },
    { id: 102, no: '02', name: '乙', inputs: { classroom: 60, trainingParts: [50, null], final: 55 }, overrides: [{ categoryKey: 'final', score: 88, state: 'OVERRIDE' }] },
  ],
  assignments: [],
  classPerf: { importId: 9, fileName: 'x.xlsx', createdAt: new Date(0), sessions: 15 },
  ...over,
})

describe('buildSnapshot', () => {
  it('每生 auto/ovr/exempt/生效/总评齐备,可离线复算;缺交计0名单单列', () => {
    const { snapshot, missingZeroStudents } = buildSnapshot(data())
    expect(snapshot.students).toHaveLength(2)
    const b = snapshot.students.find((s) => s.id === 102)!
    expect(b.cat.final).toMatchObject({ auto: 55, ovr: 88, fin: 88 })
    // 乙训练缺一次计0:(50×50 + 0×50)/100 = 25 → 记入名单
    expect(b.cat.training.auto).toBe(25)
    expect(missingZeroStudents).toEqual([102])
    // 总评 = 30×60 + 30×25 + 40×88 → 60.7
    expect(b.total).toBe(60.7)
    expect(snapshot.classAgg.total.n).toBe(2)
  })
})

describe('publishBlocker', () => {
  it('课堂比例>0 但无导入数据 → 阻断;比例设0或有数据 → 放行', () => {
    const noImport = data({ classPerf: null, students: [
      { id: 1, no: '01', name: '甲', inputs: { classroom: null, trainingParts: [90, 70], final: 75 }, overrides: [] },
    ] })
    expect(publishBlocker(noImport)).toBe('review.errPublishClassroom')
    const zeroed = data({ classPerf: null, students: noImport.students })
    zeroed.config.weights = { classroom: 0, training: 50, final: 50 }
    expect(publishBlocker(zeroed)).toBeNull()
    expect(publishBlocker(data())).toBeNull()
  })

  it('空班/比例非法 → 阻断', () => {
    expect(publishBlocker(data({ students: [] }))).toBe('review.errPublishEmpty')
    const bad = data()
    bad.config.weights = { classroom: 30, training: 30, final: 30 }
    expect(publishBlocker(bad)).toBe('review.errWeightSum')
  })
})

describe('extractStudentView(学生端隐私边界)', () => {
  it('只回本人行+匿名聚合,序列化结果不含其他学生的学号/姓名/分数行', () => {
    const { snapshot } = buildSnapshot(data())
    const view = extractStudentView(JSON.stringify(snapshot), JSON.stringify(data().config), 101)!
    expect(view.total).not.toBeNull()
    const json = JSON.stringify(view)
    expect(json).not.toContain('"乙"')
    expect(json).not.toContain('"02"')
    expect(view.classAgg.total.n).toBe(2) // 聚合仍在(匿名)
    expect(view.weights).toEqual({ classroom: 30, training: 30, final: 40 })
  })

  it('不在快照里的学生 / 快照损坏 → null(按未发布展示)', () => {
    const { snapshot } = buildSnapshot(data())
    expect(extractStudentView(JSON.stringify(snapshot), '{}', 999)).toBeNull()
    expect(extractStudentView('not-json', '{}', 101)).toBeNull()
  })
})

describe('fillSixtyTargets(无成绩/0分统一填60)', () => {
  it('挑出 fin=null 或 0 的格;已有改分/免计不重复;课堂未导入整列跳过', () => {
    const d = data({
      classPerf: null, // 课堂未导入 → classroom 列全部跳过
      students: [
        // 甲:训练缺一次→(90×50+0×50)/100=45 非0不填;期末 0 → 填
        { id: 1, no: '01', name: '甲', inputs: { classroom: null, trainingParts: [90, null], final: 0 }, overrides: [] },
        // 乙:训练两次都缺→0 → 填;期末已有老师改分 → 不动
        { id: 2, no: '02', name: '乙', inputs: { classroom: null, trainingParts: [null, null], final: null }, overrides: [{ categoryKey: 'final', score: 88, state: 'OVERRIDE' }] },
        // 丙:全有分 → 不填
        { id: 3, no: '03', name: '丙', inputs: { classroom: null, trainingParts: [80, 90], final: 70 }, overrides: [] },
      ],
    })
    const targets = fillSixtyTargets(d)
    expect(targets).toEqual([
      { studentId: 1, categoryKey: 'final' },
      { studentId: 2, categoryKey: 'training' },
    ])
  })

  it('课堂已导入时,无课堂数据的学生课堂格也填', () => {
    const d = data({
      students: [{ id: 9, no: '09', name: '丁', inputs: { classroom: null, trainingParts: [80, 80], final: 70 }, overrides: [] }],
    })
    expect(fillSixtyTargets(d)).toEqual([{ studentId: 9, categoryKey: 'classroom' }])
  })
})
