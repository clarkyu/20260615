import { describe, it, expect } from 'vitest'
import {
  assignmentStats,
  studentProfiles,
  weakSentences,
  studentWeakPoints,
  studentAssignmentScores,
  offeringSummary,
  parsePerSentence,
  latestPhaseSubmissions,
  collapsePhases,
  weightedPhaseMean,
  gradingCalibration,
  gradingCalibrationByTeacher,
  CALIBRATION_AGREE_TOL,
  type AnalyticsSubmission,
  type PhaseSubmission,
  type RawPhaseRow,
} from '@/lib/domain/analytics'

describe('weightedPhaseMean — the single multi-phase score formula (shared by collapsePhases + export)', () => {
  it('weights by phase weight; all-1 degrades to a plain mean; nulls excluded; empty → null', () => {
    expect(weightedPhaseMean([{ score: 90, weight: 3 }, { score: 50, weight: 1 }])).toBe((90 * 3 + 50) / 4) // 80
    expect(weightedPhaseMean([{ score: 80, weight: 1 }, { score: 60, weight: 1 }])).toBe(70) // equal → mean
    expect(weightedPhaseMean([{ score: 90, weight: 3 }, { score: null, weight: 5 }])).toBe(90) // null phase ignored (weight too)
    expect(weightedPhaseMean([])).toBeNull()
    expect(weightedPhaseMean([{ score: null, weight: 2 }])).toBeNull()
    expect(weightedPhaseMean([{ score: 70, weight: 0 }])).toBe(70) // weight floored to 1
  })
})

const phaseSub = (o: Partial<PhaseSubmission> & Pick<PhaseSubmission, 'studentId' | 'assignmentId'>): PhaseSubmission => ({
  phaseId: 1,
  graded: true,
  weight: 1,
  status: 'GRADED',
  finalScore: null,
  needsReview: false,
  perSentence: [],
  ...o,
})

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

  it('treats a MISSING (缺交) marker as not submitted and unscored', () => {
    const [a1] = assignmentStats(assignments, [sub({ studentId: 1, assignmentId: 10, status: 'MISSING', finalScore: null })], 3)
    expect(a1).toMatchObject({ submitted: 0, avgScore: null })
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
      phaseSub({ studentId: 1, assignmentId: 10, perSentence: [{ order: 1, accuracy: 0.9, completeness: 1 }, { order: 2, accuracy: 0.3, completeness: 1 }] }),
      phaseSub({ studentId: 2, assignmentId: 10, perSentence: [{ order: 1, accuracy: 0.8, completeness: 1 }, { order: 2, accuracy: 0.5, completeness: 1 }] }),
    ]
    const weak = weakSentences(subs)
    expect(weak[0]).toMatchObject({ assignmentId: 10, phaseId: 1, order: 2, samples: 2 })
    expect(weak[0].avgAccuracy).toBeCloseTo(0.4)
  })

  it('does NOT merge the same order across different phases', () => {
    const subs = [
      phaseSub({ studentId: 1, assignmentId: 10, phaseId: 1, perSentence: [{ order: 1, accuracy: 0.2, completeness: 1 }] }),
      phaseSub({ studentId: 1, assignmentId: 10, phaseId: 2, perSentence: [{ order: 1, accuracy: 0.9, completeness: 1 }] }),
    ]
    const weak = weakSentences(subs)
    expect(weak).toHaveLength(2) // two distinct (phase, order=1) lines, not merged
    expect(weak.map((w) => w.phaseId).sort()).toEqual([1, 2])
  })

  it('is empty without perception data', () => {
    expect(weakSentences([phaseSub({ studentId: 1, assignmentId: 10 })])).toEqual([])
  })
})

describe('studentAssignmentScores', () => {
  const assignments = [
    { id: 10, title: 'A1' },
    { id: 11, title: 'A2' },
    { id: 12, title: 'A3' },
  ]
  it('joins per-assignment score + best practice and marks never-started as not submitted', () => {
    const submissions: AnalyticsSubmission[] = [
      sub({ studentId: 1, assignmentId: 10, status: 'GRADED', finalScore: 88 }),
      sub({ studentId: 1, assignmentId: 11, status: 'UPLOADED', finalScore: null, needsReview: true }),
    ]
    const practice = [{ studentId: 1, assignmentId: 10, aiScore: 70 }, { studentId: 1, assignmentId: 10, aiScore: 82 }]
    const rows = studentAssignmentScores(submissions, assignments, practice)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ assignmentId: 10, title: 'A1', finalScore: 88, submitted: true, bestPractice: 82 })
    expect(rows[1]).toMatchObject({ assignmentId: 11, finalScore: null, submitted: true, needsReview: true, bestPractice: null })
    expect(rows[2]).toMatchObject({ assignmentId: 12, finalScore: null, submitted: false, bestPractice: null }) // never started
  })
  it('still resolves best practice when the student has no submissions', () => {
    const rows = studentAssignmentScores([], assignments, [{ studentId: 5, assignmentId: 12, aiScore: 60 }])
    expect(rows[2]).toMatchObject({ assignmentId: 12, submitted: false, bestPractice: 60 })
  })
})

describe('studentWeakPoints', () => {
  const sentences = [
    { assignmentId: 10, phaseId: 1, order: 1, text: 'Good morning.' },
    { assignmentId: 10, phaseId: 1, order: 2, text: 'How are you today?' },
  ]
  it('keeps only sub-threshold lines and joins their text, weakest first', () => {
    const rows = [
      phaseSub({ studentId: 1, assignmentId: 10, perSentence: [{ order: 1, accuracy: 0.95, completeness: 1 }, { order: 2, accuracy: 0.3, completeness: 1 }] }),
    ]
    const weak = studentWeakPoints(rows, sentences)
    expect(weak).toHaveLength(1) // order 1 (0.95) is above threshold, dropped
    expect(weak[0]).toMatchObject({ order: 2, text: 'How are you today?', samples: 1 })
    expect(weak[0].avgAccuracy).toBeCloseTo(0.3)
  })
  it('drops weak lines whose text cannot be resolved', () => {
    const rows = [phaseSub({ studentId: 1, assignmentId: 10, perSentence: [{ order: 9, accuracy: 0.1, completeness: 1 }] })]
    expect(studentWeakPoints(rows, sentences)).toEqual([])
  })
  it('respects the limit', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ assignmentId: 10, phaseId: 1, order: i + 1, text: `s${i + 1}` }))
    const rows = [phaseSub({ studentId: 1, assignmentId: 10, perSentence: many.map((s) => ({ order: s.order, accuracy: 0.2, completeness: 1 })) })]
    expect(studentWeakPoints(rows, many, { limit: 2 })).toHaveLength(2)
  })
})

describe('latestPhaseSubmissions + collapsePhases', () => {
  const raw = (o: Partial<RawPhaseRow> & Pick<RawPhaseRow, 'studentId' | 'assignmentId' | 'phaseId'>): RawPhaseRow => ({
    status: 'GRADED', finalScore: null, needsReview: false, aiResult: null, phase: { graded: true, weight: 1 }, ...o,
  })

  it('keeps the latest attempt per (student, assignment, phase)', () => {
    // rows arrive latest-first within each phase group
    const rows = [
      raw({ studentId: 1, assignmentId: 10, phaseId: 1, finalScore: 90 }),
      raw({ studentId: 1, assignmentId: 10, phaseId: 1, finalScore: 50 }), // older attempt, dropped
      raw({ studentId: 1, assignmentId: 10, phaseId: 2, finalScore: 70 }),
    ]
    const phases = latestPhaseSubmissions(rows)
    expect(phases).toHaveLength(2)
    expect(phases.find((p) => p.phaseId === 1)!.finalScore).toBe(90)
  })

  it('treats a row with no aiResult (the gradebook’s lighter query) as empty per-sentence detail', () => {
    const phases = latestPhaseSubmissions([
      { studentId: 1, assignmentId: 10, phaseId: 1, status: 'GRADED', finalScore: 88, needsReview: false, phase: { graded: true, weight: 1 } },
    ])
    expect(phases[0].perSentence).toEqual([])
    expect(phases[0].finalScore).toBe(88)
  })

  it('collapses an assignment to the mean of its GRADED phases', () => {
    const phases: PhaseSubmission[] = [
      phaseSub({ studentId: 1, assignmentId: 10, phaseId: 1, graded: true, finalScore: 80 }),
      phaseSub({ studentId: 1, assignmentId: 10, phaseId: 2, graded: true, finalScore: 60 }),
      phaseSub({ studentId: 1, assignmentId: 10, phaseId: 3, graded: false, finalScore: 10 }), // practice-only, excluded
    ]
    const [row] = collapsePhases(phases)
    expect(row.finalScore).toBe(70) // mean(80, 60); the practice-only 10 is excluded
    expect(row.status).not.toBe('DRAFT') // submitted
  })

  it('collapses to the WEIGHTED mean of graded phases (teacher-set per-phase weight)', () => {
    // phase 1 (weight 3, score 80) + phase 2 (weight 1, score 40): (80·3 + 40·1)/(3+1) = 70.
    const phases: PhaseSubmission[] = [
      phaseSub({ studentId: 1, assignmentId: 10, phaseId: 1, graded: true, finalScore: 80, weight: 3 }),
      phaseSub({ studentId: 1, assignmentId: 10, phaseId: 2, graded: true, finalScore: 40, weight: 1 }),
    ]
    expect(collapsePhases(phases)[0].finalScore).toBe(70) // equal-weight would be 60
  })

  it('feeds the existing analytics: a 2-phase assignment scores its mean', () => {
    const phases: PhaseSubmission[] = [
      phaseSub({ studentId: 1, assignmentId: 10, phaseId: 1, finalScore: 100 }),
      phaseSub({ studentId: 1, assignmentId: 10, phaseId: 2, finalScore: 0 }),
    ]
    const stats = assignmentStats([{ id: 10, title: 'A1' }], collapsePhases(phases), 1)
    expect(stats[0].avgScore).toBe(50)
    expect(stats[0].submitted).toBe(1) // one student, not two phase-rows
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

describe('gradingCalibration', () => {
  it('returns null when no submission has both an AI and a teacher score', () => {
    expect(gradingCalibration([])).toBeNull()
    expect(gradingCalibration([{ aiScore: 80, teacherScore: null }, { aiScore: null, teacherScore: 90 }])).toBeNull()
  })

  it('flags AI-too-harsh when teachers consistently raise scores (positive delta)', () => {
    const cal = gradingCalibration([
      { aiScore: 70, teacherScore: 80 },
      { aiScore: 60, teacherScore: 70 },
    ])!
    expect(cal.sampleSize).toBe(2)
    expect(cal.meanDelta).toBe(10) // teacher − ai
    expect(cal.meanAbsDelta).toBe(10)
    expect(cal.bias).toBe('harsh')
  })

  it('flags AI-too-lenient when teachers lower scores (negative delta)', () => {
    const cal = gradingCalibration([{ aiScore: 90, teacherScore: 80 }, { aiScore: 85, teacherScore: 80 }])!
    expect(cal.meanDelta).toBeLessThan(0)
    expect(cal.bias).toBe('lenient')
  })

  it('calls it fair when corrections net out within the bias tolerance', () => {
    const cal = gradingCalibration([{ aiScore: 80, teacherScore: 81 }, { aiScore: 80, teacherScore: 79 }])!
    expect(cal.meanDelta).toBe(0)
    expect(cal.bias).toBe('fair')
  })

  it('agreeRate counts only corrections within ±CALIBRATION_AGREE_TOL of the AI score', () => {
    const cal = gradingCalibration([
      { aiScore: 80, teacherScore: 80 + CALIBRATION_AGREE_TOL }, // exactly on the boundary → agrees
      { aiScore: 80, teacherScore: 80 + CALIBRATION_AGREE_TOL + 1 }, // just past → disagrees
    ])!
    expect(cal.agreeRate).toBeCloseTo(0.5)
    expect(cal.meanAbsDelta).toBeCloseTo((CALIBRATION_AGREE_TOL + (CALIBRATION_AGREE_TOL + 1)) / 2)
  })

  it('ignores rows missing either score when computing the sample', () => {
    const cal = gradingCalibration([
      { aiScore: 70, teacherScore: 75 },
      { aiScore: null, teacherScore: 80 },
      { aiScore: 60, teacherScore: null },
    ])!
    expect(cal.sampleSize).toBe(1)
    expect(cal.meanDelta).toBe(5)
  })
})

describe('gradingCalibrationByTeacher', () => {
  it('splits the signal per teacher and keeps each teacher’s identity', () => {
    const out = gradingCalibrationByTeacher([
      { teacherId: 1, teacherName: 'Ann', aiScore: 70, teacherScore: 80 }, // +10
      { teacherId: 1, teacherName: 'Ann', aiScore: 60, teacherScore: 72 }, // +12
      { teacherId: 2, teacherName: 'Bob', aiScore: 90, teacherScore: 80 }, // -10
    ])
    expect(out).toHaveLength(2)
    const ann = out.find((t) => t.teacherId === 1)!
    const bob = out.find((t) => t.teacherId === 2)!
    expect(ann.teacherName).toBe('Ann')
    expect(ann.sampleSize).toBe(2)
    expect(ann.bias).toBe('harsh')
    expect(bob.bias).toBe('lenient')
  })

  it('sorts most-reviewed first, ties broken by name', () => {
    const out = gradingCalibrationByTeacher([
      { teacherId: 1, teacherName: 'Solo', aiScore: 70, teacherScore: 75 },
      { teacherId: 2, teacherName: 'Zoe', aiScore: 70, teacherScore: 75 },
      { teacherId: 2, teacherName: 'Zoe', aiScore: 70, teacherScore: 75 },
      { teacherId: 3, teacherName: 'Amy', aiScore: 70, teacherScore: 75 },
    ])
    expect(out.map((t) => t.teacherName)).toEqual(['Zoe', 'Amy', 'Solo']) // Zoe (2) first; Amy<Solo on tie of 1
  })

  it('omits a teacher whose rows never have both scores', () => {
    const out = gradingCalibrationByTeacher([
      { teacherId: 1, teacherName: 'Ann', aiScore: 70, teacherScore: 80 },
      { teacherId: 2, teacherName: 'NoData', aiScore: null, teacherScore: 80 },
      { teacherId: 2, teacherName: 'NoData', aiScore: 60, teacherScore: null },
    ])
    expect(out.map((t) => t.teacherId)).toEqual([1])
  })

  it('returns [] for no rows', () => {
    expect(gradingCalibrationByTeacher([])).toEqual([])
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
  it('returns [] when valid JSON lacks a perSentence array', () => {
    expect(parsePerSentence(JSON.stringify({ judge: { score: 5 } }))).toEqual([])
    expect(parsePerSentence(JSON.stringify({ perception: { perSentence: 'nope' } }))).toEqual([])
  })
})
