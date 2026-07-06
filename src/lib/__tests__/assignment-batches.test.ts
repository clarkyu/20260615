import { describe, it, expect } from 'vitest'
import { groupAssignmentBatches, type BatchAssignmentRow } from '@/lib/assignment-batches'

const row = (over: Partial<BatchAssignmentRow> & { id: number }): BatchAssignmentRow => ({
  title: 'A', category: null, mode: null, dueAt: null, batchId: null, phaseCount: 1, courseId: 1, courseName: 'Eng', className: 'C1', ...over,
})

describe('groupAssignmentBatches', () => {
  it('groups a multi-class publish (shared batchId) into one batch with per-class + aggregate counts', () => {
    const list = [
      row({ id: 1, batchId: 'b1', className: 'C1' }),
      row({ id: 2, batchId: 'b1', className: 'C2' }),
      row({ id: 3, batchId: 'b1', className: 'C3' }),
    ]
    const groups = groupAssignmentBatches(list, new Map([[1, 5], [2, 3], [3, 0]]), new Map([[1, 2], [2, 1], [3, 0]]))
    expect(groups).toHaveLength(1)
    expect(groups[0].classes.map((c) => c.className)).toEqual(['C1', 'C2', 'C3'])
    expect(groups[0].totalSubmitted).toBe(8)
    expect(groups[0].totalPending).toBe(3)
    expect(groups[0].classes[0]).toMatchObject({ assignmentId: 1, submitted: 5, pending: 2 })
  })

  it('groups legacy (no batchId) copies by same title + same course; different title/course stay apart', () => {
    const list = [
      row({ id: 1, title: 'Unit 3', courseId: 10, className: 'C1' }),
      row({ id: 2, title: 'Unit 3', courseId: 10, className: 'C2' }), // same → grouped with #1
      row({ id: 3, title: 'Unit 3', courseId: 99, className: 'C1' }), // different course → own group
      row({ id: 4, title: 'Unit 4', courseId: 10, className: 'C1' }), // different title → own group
    ]
    const groups = groupAssignmentBatches(list, new Map(), new Map())
    expect(groups).toHaveLength(3)
    expect(groups[0].classes.map((c) => c.assignmentId)).toEqual([1, 2])
    expect(groups[1].classes.map((c) => c.assignmentId)).toEqual([3])
    expect(groups[2].classes.map((c) => c.assignmentId)).toEqual([4])
  })

  it('keeps a batchId group separate from a same-title legacy group', () => {
    const list = [row({ id: 1, title: 'X', batchId: 'b1' }), row({ id: 2, title: 'X', batchId: null })]
    const groups = groupAssignmentBatches(list, new Map(), new Map())
    expect(groups).toHaveLength(2) // batch:b1 vs legacy:1:X
  })

  it('preserves list order (newest-first) for the groups', () => {
    const list = [row({ id: 1, batchId: 'newest' }), row({ id: 2, batchId: 'older' })]
    expect(groupAssignmentBatches(list, new Map(), new Map()).map((g) => g.key)).toEqual(['batch:newest', 'batch:older'])
  })
})
