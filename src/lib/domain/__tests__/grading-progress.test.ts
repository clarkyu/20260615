import { describe, it, expect } from 'vitest'
import { gradingStage } from '../grading-progress'

describe('gradingStage', () => {
  it('maps a settled submission to done regardless of the job (含 FLAGGED 待复核)', () => {
    expect(gradingStage('GRADED', 'DONE')).toBe('done')
    expect(gradingStage('GRADED', 'FAILED')).toBe('done') // 幽灵死信也不吓学生
    expect(gradingStage('FLAGGED', null)).toBe('done')
  })

  it('maps the live queue states: PENDING→queued, PROCESSING→running', () => {
    expect(gradingStage('UPLOADED', 'PENDING')).toBe('queued')
    expect(gradingStage('UPLOADED', 'PROCESSING')).toBe('running')
    expect(gradingStage('PROCESSING', 'PROCESSING')).toBe('running')
  })

  it('maps a dead-lettered job to teacher — 失败即转老师,不透出机器语义', () => {
    expect(gradingStage('UPLOADED', 'FAILED')).toBe('teacher')
    expect(gradingStage('FAILED', 'FAILED')).toBe('teacher')
  })

  it('maps a FAILED submission with a pending retry back to queued (自愈重试中)', () => {
    expect(gradingStage('FAILED', 'PENDING')).toBe('queued')
    expect(gradingStage('FAILED', 'PROCESSING')).toBe('running')
  })

  it('maps a stuck/abandoned submission without a live job to teacher', () => {
    expect(gradingStage('PROCESSING', null)).toBe('teacher')
    expect(gradingStage('FAILED', null)).toBe('teacher')
    expect(gradingStage('PROCESSING', 'DONE')).toBe('teacher')
  })

  it('hides the progress chip for non-AI flows and unknown rows (none)', () => {
    expect(gradingStage('UPLOADED', null)).toBe('none') // 客观题/投票/纯待老师
    expect(gradingStage('UPLOADED', 'DONE')).toBe('none') // 队列结算无可评(改型等)
    expect(gradingStage(null, null)).toBe('none')
    expect(gradingStage('DRAFT', null)).toBe('none')
    expect(gradingStage('MISSING', null)).toBe('none')
  })
})
