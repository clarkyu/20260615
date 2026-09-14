import { describe, it, expect } from 'vitest'
import { computeAssignmentStats, statsToCsvRows, type StatItem, type StatResponse, type StatStudent } from '@/lib/stats/assignment-stats'
import { CSV_BOM, contentDisposition, csvCell, toCsv, toCsvWithBom } from '@/lib/stats/csv'

// 学情统计与 CSV(SPEC §8):纯函数表驱动。

const items: StatItem[] = [
  { id: 'i1', number: 1, type: 'fill', score: 2, sectionId: 's1', sectionTitle: '一、短文填空' },
  { id: 'i2', number: 2, type: 'fill', score: 2, sectionId: 's1', sectionTitle: '一、短文填空' },
  { id: 'i3', number: 3, type: 'short_answer', score: 4, sectionId: 's2', sectionTitle: '四、阅读问答' },
]
const students: StatStudent[] = [
  { userId: 'u1', name: '甲', attemptId: 'a1', status: 'submitted', totalScore: 6 },
  { userId: 'u2', name: '乙', attemptId: 'a2', status: 'released', totalScore: 2 },
  { userId: 'u3', name: '丙', attemptId: 'a3', status: 'in_progress', totalScore: null },
  { userId: 'u4', name: '丁', attemptId: null, status: 'not_started', totalScore: null },
]
const responses: StatResponse[] = [
  { attemptId: 'a1', itemId: 'i1', score: 2, verdict: 'correct', answerText: 'big' },
  { attemptId: 'a1', itemId: 'i2', score: 0, verdict: 'wrong', answerText: 'Finishing' },
  { attemptId: 'a1', itemId: 'i3', score: 4, verdict: 'graded', answerText: 'Because...' },
  { attemptId: 'a2', itemId: 'i1', score: 0, verdict: 'wrong', answerText: 'bigger ' },
  { attemptId: 'a2', itemId: 'i2', score: 0, verdict: 'wrong', answerText: 'finishing' },
  { attemptId: 'a2', itemId: 'i3', score: null, verdict: 'pending', answerText: 'He...' },
  { attemptId: 'a3', itemId: 'i1', score: 2, verdict: 'correct', answerText: 'big' }, // 作答中,不计
]

describe('computeAssignmentStats', () => {
  const st = computeAssignmentStats(items, students, responses)
  it('分母 = 已交人数;作答中 / 未开始不计', () => {
    expect(st.items[0]!.submitted).toBe(2)
    expect(st.distribution.submitted).toBe(2)
  })
  it('客观题正确率 = 答对 / 已交;常见错答规范化合并、按次数排序', () => {
    expect(st.items[0]).toMatchObject({ correct: 1, rate: 0.5, topWrong: [{ answer: 'bigger', count: 1 }] })
    expect(st.items[1]).toMatchObject({ correct: 0, rate: 0, topWrong: [{ answer: 'finishing', count: 2 }] })
  })
  it('主观题得分率 = 平均分 / 满分,待评不进分母', () => {
    expect(st.items[2]).toMatchObject({ objective: false, pending: 1, avgScore: 4, rate: 1 })
  })
  it('分大题得分率与满分', () => {
    expect(st.fullScore).toBe(8)
    expect(st.sections).toEqual([
      { sectionId: 's1', title: '一、短文填空', fullScore: 4, avgScore: 1, rate: 0.25 },
      { sectionId: 's2', title: '四、阅读问答', fullScore: 4, avgScore: 4, rate: 1 },
    ])
  })
  it('分布:有待评小题的学生不进均值 / 中位 / 分档,单独计数', () => {
    // 乙的主观题待评 → 总分不完整,不进分布;只剩甲 6/8=75%
    expect(st.distribution).toMatchObject({ submitted: 2, pendingStudents: 1, mean: 6, median: 6, max: 6, min: 6 })
    expect(st.distribution.bins.map((b) => b.count)).toEqual([0, 0, 1, 0, 0])
  })
  it('学生矩阵:未交为 null,未答为 0,待评为 null;待评标记', () => {
    expect(st.students.map((s) => s.scores)).toEqual([
      [2, 0, 4],
      [0, 0, null],
      [null, null, null],
      [null, null, null],
    ])
    expect(st.students[2]!.totalScore).toBeNull()
    expect(st.students.map((s) => s.pending)).toEqual([false, true, false, false])
  })
  it('分大题得分率用未取整的每题均值累加', () => {
    // 8 人已交,5 人答对 2 分题:均值 1.25 → 展示 1.3,但大题累计按 1.25
    const eight: StatStudent[] = Array.from({ length: 8 }, (_, i) => ({ userId: `s${i}`, name: `s${i}`, attemptId: `t${i}`, status: 'submitted', totalScore: 0 }))
    const rs: StatResponse[] = eight.flatMap((s, i) => [{ attemptId: s.attemptId!, itemId: 'i1', score: i < 5 ? 2 : 0, verdict: i < 5 ? 'correct' : 'wrong', answerText: 'x' }])
    const one = computeAssignmentStats([items[0]!], eight, rs)
    expect(one.items[0]!.avgScore).toBe(1.3)
    expect(one.sections[0]).toMatchObject({ avgScore: 1.3, rate: 0.625 })
  })
  it('空任务不崩', () => {
    const empty = computeAssignmentStats(items, [], [])
    expect(empty.items[0]!.rate).toBeNull()
    expect(empty.distribution.mean).toBeNull()
    expect(empty.sections[0]!.avgScore).toBe(0)
  })
})

describe('CSV', () => {
  it.each([
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line\nbreak', '"line\nbreak"'],
    ['=1+1', "'=1+1"],
    ['-5', '-5'],
    [null, ''],
    [3.5, '3.5'],
  ])('%s → %s', (v, want) => {
    expect(csvCell(v)).toBe(want)
  })
  it('CRLF + BOM', () => {
    expect(toCsv([['a', 1], ['b', 2]])).toBe('a,1\r\nb,2\r\n')
    expect(toCsvWithBom([['x']]).startsWith(CSV_BOM)).toBe(true)
  })
  it('中文文件名 RFC 5987', () => {
    const cd = contentDisposition('期中-一班-学情.csv')
    expect(cd).toContain("filename*=UTF-8''")
    expect(cd).toContain(encodeURIComponent('期中-一班-学情.csv'))
    expect(cd).toMatch(/filename="[\x20-\x7e]+"/)
  })
  it('statsToCsvRows:矩阵 + 每题统计 + 大题 + 分布', () => {
    const st = computeAssignmentStats(items, students, responses)
    const rows = statsToCsvRows(st, { title: '期中', className: '一班' })
    expect(rows[1]).toEqual(['学生', '状态', '总分', '1', '2', '3'])
    expect(rows[2]).toEqual(['甲', '已交卷', 6, 2, 0, 4])
    expect(rows[3]).toEqual(['乙', '已发布（有待评）', 2, 0, 0, ''])
    const itemHeader = rows.findIndex((r) => r[0] === '题号')
    expect(rows[itemHeader + 2]!.slice(0, 9)).toEqual([2, '一、短文填空', 'fill', 2, 2, 2, 0, '0%', 0])
    expect(rows[itemHeader + 2]![9]).toBe('finishing（2）')
    const text = toCsvWithBom(rows)
    expect(text.split('\r\n').length).toBeGreaterThan(10)
  })
})
