import { describe, it, expect } from 'vitest'
import { groupUnmatched, type UnmatchedRow } from '@/lib/poll-workbench'

const row = (submissionId: number, text: string, textLen = text.length): UnmatchedRow => ({
  submissionId, studentName: `学生${submissionId}`, studentNo: `S${submissionId}`, text, textLen, history: [],
})

describe('groupUnmatched — 相同作答聚组', () => {
  it('相同文本聚成一组,组间按人数降序;key 稳定为「长度:文本」', () => {
    const rows = [row(1, '自我介绍'), row(2, '想去春游'), row(3, '自我介绍'), row(4, '自我介绍')]
    const groups = groupUnmatched(rows)
    expect(groups.map((g) => g.rows.length)).toEqual([3, 1])
    expect(groups[0].text).toBe('自我介绍')
    expect(groups[0].key).toBe('4:自我介绍')
    expect(groups[0].rows.map((r) => r.submissionId)).toEqual([1, 3, 4])
  })

  it('截断后相同、原文长度不同的长文不并组(textLen 参与组键,复查 R11)', () => {
    // 服务端截断后两篇 400 字展示文本相同,但原文一个 500、一个 600 字——不是同一份作答。
    const clipped = 'x'.repeat(399) + '…'
    const groups = groupUnmatched([row(1, clipped, 500), row(2, clipped, 600)])
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.key).sort()).toEqual([`500:${clipped}`, `600:${clipped}`])
  })
})
