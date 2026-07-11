// 成绩档案树:统计合成口径、老师树分组(学期/类别/批次聚合/环节并集/班级排序)、
// 学生档案分组(最新 attempt/学期任务时间排序/总分注入)。全部纯函数,零 prisma。
import { describe, expect, it } from 'vitest'
import {
  buildStudentArchive,
  buildTeacherArchive,
  combinePhaseStats,
  type ArchiveAssignmentRow,
  type StudentArchiveRow,
} from '../archive-view'

const off = (id: number, cls: string, classId = id) => ({
  id,
  year: '2025-2026',
  semester: '2',
  classId,
  course: { name: '大学英语（二）' },
  class: { name: cls },
})

const asg = (id: number, over: Partial<ArchiveAssignmentRow> = {}): ArchiveAssignmentRow => ({
  id,
  batchId: null,
  title: '任务A',
  mode: 'TRAINING',
  dueAt: new Date('2026-05-01'),
  offering: off(id, `班${id}`),
  phases: [
    { id: id * 10 + 1, order: 1, title: '选题' },
    { id: id * 10 + 2, order: 2, title: '文本' },
  ],
  ...over,
})

describe('combinePhaseStats', () => {
  it('已交=非DRAFT/MISSING;已评=GRADED;均分取 GRADED 组', () => {
    const m = combinePhaseStats([
      { phaseId: 11, status: 'GRADED', _count: { _all: 30 }, _avg: { finalScore: 88.46 } },
      { phaseId: 11, status: 'UPLOADED', _count: { _all: 5 }, _avg: { finalScore: null } },
      { phaseId: 11, status: 'MISSING', _count: { _all: 2 }, _avg: { finalScore: null } },
      { phaseId: null, status: 'GRADED', _count: { _all: 9 }, _avg: { finalScore: 50 } },
    ])
    expect(m.get(11)).toEqual({ submitted: 35, graded: 30, avg: 88.5 })
    expect(m.size).toBe(1) // 无环节的行不进统计
  })
})

describe('buildTeacherArchive', () => {
  it('同 batchId 跨班聚合为一个任务;环节按 order 并集;班级按名排序;无 mode 归 OTHER', () => {
    const rows = [
      asg(1, { batchId: 'B1', offering: off(1, '2531321') }),
      asg(2, { batchId: 'B1', offering: off(2, '2531320') }),
      asg(3, { title: '老作业', mode: null, batchId: null, dueAt: new Date('2026-03-01') }),
    ]
    const stats = new Map([[11, { submitted: 40, graded: 40, avg: 85 }]])
    const sizes = new Map([
      [1, 50],
      [2, 57],
    ])
    const sems = buildTeacherArchive(rows, stats, sizes)
    expect(sems).toHaveLength(1)
    expect(sems[0]).toMatchObject({ year: '2025-2026', semester: '2' })
    const modes = sems[0].categories.map((c) => c.mode)
    expect(modes).toEqual(['TRAINING', 'OTHER'])

    const training = sems[0].categories[0]
    expect(training.tasks).toHaveLength(1) // 两班聚合成一个任务
    const task = training.tasks[0]
    expect(task.classCount).toBe(2)
    expect(task.phases.map((p) => p.order)).toEqual([1, 2])
    // 班级排序 + 统计落点:环节1 里 2531320 在前;asg1 的 phase 11 有统计
    expect(task.phases[0].classes.map((c) => c.className)).toEqual(['2531320', '2531321'])
    const c21 = task.phases[0].classes.find((c) => c.className === '2531321')!
    expect(c21).toMatchObject({ assignmentId: 1, size: 50, stat: { submitted: 40, graded: 40, avg: 85 } })
  })

  it('任务按最晚截止倒序;某班缺该环节时 stat=null 但班仍保留', () => {
    const rows = [
      asg(1, { batchId: 'B1', title: '早任务', dueAt: new Date('2026-03-01') }),
      asg(2, { batchId: 'B2', title: '晚任务', dueAt: new Date('2026-06-01') }),
      // B2 的另一个班少了环节2
      asg(3, { batchId: 'B2', title: '晚任务', offering: off(3, '2531322'), phases: [{ id: 31, order: 1, title: '选题' }] }),
    ]
    const sems = buildTeacherArchive(rows, new Map(), new Map())
    const tasks = sems[0].categories[0].tasks
    expect(tasks.map((t) => t.title)).toEqual(['晚任务', '早任务'])
    const ph2 = tasks[0].phases.find((p) => p.order === 2)!
    expect(ph2.classes.find((c) => c.assignmentId === 3)?.stat).toBeNull()
  })
})

describe('buildStudentArchive', () => {
  const srow = (assignmentId: number, phaseId: number, order: number, over: Partial<StudentArchiveRow> = {}): StudentArchiveRow => ({
    studentId: 7,
    assignmentId,
    phaseId,
    status: 'GRADED',
    finalScore: 90,
    needsReview: false,
    updatedAt: new Date('2026-05-02'),
    phase: { graded: true, weight: 1, order, title: null },
    assignment: {
      id: assignmentId,
      title: `任务${assignmentId}`,
      mode: 'TRAINING',
      dueAt: new Date(`2026-0${assignmentId}-01`),
      offering: { id: 1, year: '2025-2026', semester: '2', course: { name: 'c' }, class: { name: 'k' } },
    },
    ...over,
  })

  it('每环节取最新 attempt(首见);任务按截止倒序;总分从注入表取', () => {
    const rows = [
      srow(5, 51, 1, { finalScore: 95 }), // attempt desc:第一行是最新
      srow(5, 51, 1, { finalScore: 60 }), // 旧 attempt,应被忽略
      srow(5, 52, 2, { status: 'UPLOADED', finalScore: null }),
      srow(3, 31, 1),
    ]
    const sems = buildStudentArchive(rows, new Map([[5, 92.5]]))
    expect(sems).toHaveLength(1)
    expect(sems[0].tasks.map((t) => t.assignmentId)).toEqual([5, 3]) // 05-01 > 03-01
    const t5 = sems[0].tasks[0]
    expect(t5.total).toBe(92.5)
    expect(t5.phases.map((p) => [p.order, p.score])).toEqual([
      [1, 95],
      [2, null],
    ])
    expect(sems[0].tasks[1].total).toBeNull() // 未注入 → null
  })
})
