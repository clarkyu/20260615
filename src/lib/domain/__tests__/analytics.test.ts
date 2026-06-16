import { describe, it, expect } from 'vitest'
import {
  assignmentStats,
  studentProfiles,
  weakSentences,
  offeringSummary,
  parsePerSentence,
  type AnalyticsSubmission,
} from '@/lib/domain/analytics'

const students = [
  { id: 1, name: '甲', studentNo: '001' },
  { id: 2, name: '乙', studentNo: '002' },
]
const assignments = [
  { id: 10, title: 'A1' },
  { id: 11, title: 'A2' },
]
const sub = (o: Partial<AnalyticsSubmission> & Pick<AnalyticsSubmission, 'studentId' | 'assignmentId'>): AnalyticsSubmission => ({
  status: 'GRADED',
  finalScore: null,
  needsReview: false,
  perSentence: [],
  ...o,
})

describe('assignmentStats', () => {
  it('counts distinct submitters, averages scores, ignores drafts', () => {
    const subs = [
      sub({ studentId: 1, assignmentId: 10, finalScore: 80 }),
      sub({ studentId: 2, assignmentId: 10, finalScore: 60 }),
      sub({ studentId: 1, assignmentId: 11, status: 'DRAFT', finalScore: null }),
    ]
    const [a1, a2] = assignmentStats(assignments, subs, 2)
    expect(a1).toMatchObject({ submitted: 2, total: 2, avgScore: 70 })
    expect(a2).toMatchObject({ submitted: 0, avgScore: null })
  })
})

describe('studentProfiles', () => {
  it('flags low submission rate and low average, at-risk first', () => {
    const assignments3 = [
      { id: 10, title: 'A1' },
      { id: 11, title: 'A2' },
      { id: 12, title: 'A3' },
    ]
    const subs = [
      sub({ studentId: 1, assignmentId: 10, finalScore: 90 }),
      sub({ studentId: 1, assignmentId: 11, finalScore: 88 }),
      sub({ studentId: 1, assignmentId: 12, finalScore: 89 }),
      sub({ studentId: 2, assignmentId: 10, finalScore: 40 }), // 1/3 submitted, low score
    ]
    const profiles = studentProfiles(students, assignments3, subs)
    expect(profiles[0].id).toBe(2) // at-risk sorts first
    expect(profiles[0].atRisk).toBe(true)
    expect(profiles[0].riskReasons).toContain('risk.lowSubmit')
    expect(profiles[0].riskReasons).toContain('risk.lowScore')
    expect(profiles[1].atRisk).toBe(false)
    expect(profiles[1].avgScore).toBe(89)
  })
})

describe('平时成绩 from practice', () => {
  it('averages the best practice score per assignment, independent of submissions', () => {
    const practice = [
      { studentId: 1, assignmentId: 10, aiScore: 60 },
      { studentId: 1, assignmentId: 10, aiScore: 85 }, // best for assignment 10
      { studentId: 1, assignmentId: 11, aiScore: 75 },
    ]
    const profiles = studentProfiles(students, assignments, [], practice)
    const p1 = profiles.find((p) => p.id === 1)!
    expect(p1.dailyScore).toBe(80) // (85 + 75) / 2
    const p2 = profiles.find((p) => p.id === 2)!
    expect(p2.dailyScore).toBeNull() // never practiced
  })

  it('rolls up into offeringSummary.dailyAvg', () => {
    const practice = [{ studentId: 1, assignmentId: 10, aiScore: 90 }]
    const stats = assignmentStats(assignments, [], 2)
    const profiles = studentProfiles(students, assignments, [], practice)
    expect(offeringSummary(stats, profiles, 2).dailyAvg).toBe(90)
  })
})

describe('weakSentences', () => {
  it('ranks the hardest lines by average accuracy', () => {
    const subs = [
      sub({ studentId: 1, assignmentId: 10, perSentence: [{ order: 1, accuracy: 0.9, completeness: 1 }, { order: 2, accuracy: 0.3, completeness: 1 }] }),
      sub({ studentId: 2, assignmentId: 10, perSentence: [{ order: 1, accuracy: 0.8, completeness: 1 }, { order: 2, accuracy: 0.5, completeness: 1 }] }),
    ]
    const weak = weakSentences(subs)
    expect(weak[0]).toMatchObject({ assignmentId: 10, order: 2, samples: 2 })
    expect(weak[0].avgAccuracy).toBeCloseTo(0.4)
  })

  it('is empty without perception data', () => {
    expect(weakSentences([sub({ studentId: 1, assignmentId: 10 })])).toEqual([])
  })
})

describe('offeringSummary', () => {
  it('computes submission rate across all slots and counts at-risk', () => {
    const subs = [
      sub({ studentId: 1, assignmentId: 10, finalScore: 80 }),
      sub({ studentId: 2, assignmentId: 10, finalScore: 50 }),
    ]
    const stats = assignmentStats(assignments, subs, 2)
    const profiles = studentProfiles(students, assignments, subs)
    const summary = offeringSummary(stats, profiles, 2)
    expect(summary.submissionRate).toBeCloseTo(2 / 4) // 2 submitted of 2 students × 2 assignments
    expect(summary.atRisk).toBeGreaterThanOrEqual(1)
  })
})

describe('parsePerSentence', () => {
  it('extracts per-sentence data from a GradeResult JSON', () => {
    const json = JSON.stringify({ perception: { perSentence: [{ order: 1, accuracy: 0.7, completeness: 0.9 }] } })
    expect(parsePerSentence(json)).toEqual([{ order: 1, accuracy: 0.7, completeness: 0.9 }])
  })
  it('returns [] for null/garbage', () => {
    expect(parsePerSentence(null)).toEqual([])
    expect(parsePerSentence('not json')).toEqual([])
  })
})
