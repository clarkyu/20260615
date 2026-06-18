// Learning analytics — computed on the fly from the submissions/practice the app
// already collects. No precomputed mastery table, so nothing can go stale; at a
// school's scale the aggregation is cheap. All functions here are pure and
// unit-tested; the page layer only loads rows and renders.

export interface AnalyticsStudent {
  id: number
  name: string
  studentNo: string
}

export interface AnalyticsAssignment {
  id: number
  title: string
}

export interface AnalyticsSubmission {
  studentId: number
  assignmentId: number
  status: string
  finalScore: number | null
  needsReview: boolean
  perSentence: { order: number; accuracy: number; completeness: number }[]
}

// A submission is per-PHASE now. The raw row (one per submitted phase attempt) the
// repo hands the analytics layer; `phase.graded` says whether the phase counts.
export interface RawPhaseRow {
  studentId: number
  assignmentId: number
  phaseId: number | null
  status: string
  finalScore: number | null
  needsReview: boolean
  aiResult: string | null
  phase: { graded: boolean } | null
}

// The latest non-DRAFT submission per (student, assignment, phase). `rows` arrive
// ordered with the latest attempt first within each phase group.
export interface PhaseSubmission {
  studentId: number
  assignmentId: number
  phaseId: number | null
  graded: boolean
  status: string
  finalScore: number | null
  needsReview: boolean
  perSentence: { order: number; accuracy: number; completeness: number }[]
}

export function latestPhaseSubmissions(rows: RawPhaseRow[]): PhaseSubmission[] {
  const seen = new Set<string>()
  const out: PhaseSubmission[] = []
  for (const s of rows) {
    const key = `${s.studentId}:${s.assignmentId}:${s.phaseId ?? 0}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      studentId: s.studentId,
      assignmentId: s.assignmentId,
      phaseId: s.phaseId ?? null,
      graded: s.phase?.graded ?? true,
      status: s.status,
      finalScore: s.finalScore,
      needsReview: s.needsReview,
      perSentence: parsePerSentence(s.aiResult),
    })
  }
  return out
}

// Collapse the per-phase submissions of an assignment into ONE analytics row per
// (student, assignment): score = mean of the GRADED phases' final scores; submitted if
// any phase is in; needsReview if any phase needs review. This is the single place that
// defines "a multi-phase assignment's one score" — the mean of its graded phases.
export function collapsePhases(rows: PhaseSubmission[]): AnalyticsSubmission[] {
  const byPair = new Map<string, PhaseSubmission[]>()
  for (const r of rows) {
    const k = `${r.studentId}:${r.assignmentId}`
    const arr = byPair.get(k)
    if (arr) arr.push(r)
    else byPair.set(k, [r])
  }
  const out: AnalyticsSubmission[] = []
  for (const group of byPair.values()) {
    const submitted = group.filter((g) => g.status !== 'DRAFT')
    const gradedScores = submitted.filter((g) => g.graded && g.finalScore != null).map((g) => g.finalScore as number)
    const finalScore = gradedScores.length ? gradedScores.reduce((a, b) => a + b, 0) / gradedScores.length : null
    out.push({
      studentId: group[0].studentId,
      assignmentId: group[0].assignmentId,
      // A non-DRAFT marker so isSubmitted() counts it; analytics never reads the value.
      status: submitted.length > 0 ? 'UPLOADED' : 'DRAFT',
      finalScore,
      needsReview: submitted.some((g) => g.needsReview),
      perSentence: [],
    })
  }
  return out
}

// One practice round (训练). Feeds the 平时成绩, separate from the graded submission.
export interface AnalyticsPractice {
  studentId: number
  assignmentId: number
  aiScore: number | null
}

// Best scored practice per (student, assignment) — rewards practicing to mastery.
function bestPracticeByPair(practice: AnalyticsPractice[]): Map<string, number> {
  const best = new Map<string, number>()
  for (const p of practice) {
    if (p.aiScore == null) continue
    const key = `${p.studentId}:${p.assignmentId}`
    const cur = best.get(key)
    if (cur == null || p.aiScore > cur) best.set(key, p.aiScore)
  }
  return best
}

export const RISK_SCORE = 60
export const RISK_SUBMIT_RATE = 0.5

function isSubmitted(status: string): boolean {
  return status !== 'DRAFT'
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

export interface AssignmentStat {
  id: number
  title: string
  submitted: number
  total: number
  avgScore: number | null
  needsReview: number
}

export function assignmentStats(
  assignments: AnalyticsAssignment[],
  submissions: AnalyticsSubmission[],
  totalStudents: number,
): AssignmentStat[] {
  return assignments.map((a) => {
    const subs = submissions.filter((s) => s.assignmentId === a.id && isSubmitted(s.status))
    const scored = subs.map((s) => s.finalScore).filter((v): v is number => v != null)
    const avg = mean(scored)
    return {
      id: a.id,
      title: a.title,
      submitted: new Set(subs.map((s) => s.studentId)).size,
      total: totalStudents,
      avgScore: avg == null ? null : round1(avg),
      needsReview: subs.filter((s) => s.needsReview).length,
    }
  })
}

export interface StudentProfile {
  id: number
  name: string
  studentNo: string
  submitted: number
  totalAssignments: number
  avgScore: number | null // 测试成绩: average of graded submissions
  dailyScore: number | null // 平时成绩: average of best practice scores
  atRisk: boolean
  riskReasons: string[] // i18n keys
}

export function studentProfiles(
  students: AnalyticsStudent[],
  assignments: AnalyticsAssignment[],
  submissions: AnalyticsSubmission[],
  practice: AnalyticsPractice[] = [],
): StudentProfile[] {
  const total = assignments.length
  const best = bestPracticeByPair(practice)
  return students
    .map((st) => {
      const subs = submissions.filter((s) => s.studentId === st.id && isSubmitted(s.status))
      const submitted = new Set(subs.map((s) => s.assignmentId)).size
      const avg = mean(subs.map((s) => s.finalScore).filter((v): v is number => v != null))
      // 平时成绩: mean over assignments the student actually practiced (best per assignment).
      const daily = mean(
        assignments.map((a) => best.get(`${st.id}:${a.id}`)).filter((v): v is number => v != null),
      )
      const rate = total ? submitted / total : 1
      const riskReasons: string[] = []
      if (total > 0 && rate < RISK_SUBMIT_RATE) riskReasons.push('risk.lowSubmit')
      if (avg != null && avg < RISK_SCORE) riskReasons.push('risk.lowScore')
      return {
        id: st.id,
        name: st.name,
        studentNo: st.studentNo,
        submitted,
        totalAssignments: total,
        avgScore: avg == null ? null : round1(avg),
        dailyScore: daily == null ? null : round1(daily),
        atRisk: riskReasons.length > 0,
        riskReasons,
      }
    })
    .sort((a, b) => {
      // At-risk first; then lowest average; then by name.
      if (a.atRisk !== b.atRisk) return a.atRisk ? -1 : 1
      const av = a.avgScore ?? Infinity
      const bv = b.avgScore ?? Infinity
      if (av !== bv) return av - bv
      return a.name.localeCompare(b.name)
    })
}

export interface WeakSentence {
  assignmentId: number
  phaseId: number | null
  order: number
  avgAccuracy: number
  samples: number
}

// Aggregates per-sentence accuracy across students to surface the hardest lines.
// Keyed by (assignment, PHASE, order): two phases of one assignment can both have a
// sentence #1 with different text, so they must not be merged. Empty until AI
// perception data exists.
export function weakSentences(submissions: PhaseSubmission[], limit = 5): WeakSentence[] {
  const agg = new Map<string, { sum: number; n: number; assignmentId: number; phaseId: number | null; order: number }>()
  for (const s of submissions) {
    for (const p of s.perSentence) {
      const key = `${s.assignmentId}:${s.phaseId ?? 0}:${p.order}`
      const cur = agg.get(key) ?? { sum: 0, n: 0, assignmentId: s.assignmentId, phaseId: s.phaseId ?? null, order: p.order }
      cur.sum += p.accuracy
      cur.n += 1
      agg.set(key, cur)
    }
  }
  return [...agg.values()]
    .map((v) => ({ assignmentId: v.assignmentId, phaseId: v.phaseId, order: v.order, avgAccuracy: round2(v.sum / v.n), samples: v.n }))
    .sort((a, b) => a.avgAccuracy - b.avgAccuracy)
    .slice(0, limit)
}

// One sentence a student keeps getting wrong — the building block of 「我的薄弱点」.
export interface MyWeakPoint {
  assignmentId: number
  phaseId: number | null
  order: number
  text: string
  avgAccuracy: number
  samples: number
}

// A single student's weakest lines across all their own graded submissions, joined to
// the sentence text. Reuses `weakSentences` (phase-aware) over just this student's
// rows, keeps only those below `threshold`, and drops any without resolvable text.
export function studentWeakPoints(
  rows: PhaseSubmission[],
  sentences: { assignmentId: number; phaseId: number | null; order: number; text: string }[],
  opts: { limit?: number; threshold?: number } = {},
): MyWeakPoint[] {
  const limit = opts.limit ?? 12
  const threshold = opts.threshold ?? 0.7
  const text = new Map(sentences.map((s) => [`${s.assignmentId}:${s.phaseId ?? 0}:${s.order}`, s.text]))
  return weakSentences(rows, Number.MAX_SAFE_INTEGER)
    .filter((w) => w.avgAccuracy < threshold)
    .map((w) => ({
      assignmentId: w.assignmentId,
      phaseId: w.phaseId,
      order: w.order,
      avgAccuracy: w.avgAccuracy,
      samples: w.samples,
      text: text.get(`${w.assignmentId}:${w.phaseId ?? 0}:${w.order}`) ?? '',
    }))
    .filter((w) => w.text)
    .slice(0, limit)
}

export interface OfferingSummary {
  students: number
  assignments: number
  submissionRate: number // 0..1 across all student×assignment slots
  avgScore: number | null // 测试成绩 (submissions)
  dailyAvg: number | null // 平时成绩 (practice)
  needsReview: number
  atRisk: number
}

export function offeringSummary(
  stats: AssignmentStat[],
  profiles: StudentProfile[],
  totalStudents: number,
): OfferingSummary {
  const slots = stats.length * totalStudents
  const submitted = stats.reduce((x, s) => x + s.submitted, 0)
  const avgs = stats.map((s) => s.avgScore).filter((v): v is number => v != null)
  const avg = mean(avgs)
  const dailyAvg = mean(profiles.map((p) => p.dailyScore).filter((v): v is number => v != null))
  return {
    students: totalStudents,
    assignments: stats.length,
    submissionRate: slots ? submitted / slots : 0,
    avgScore: avg == null ? null : round1(avg),
    dailyAvg: dailyAvg == null ? null : round1(dailyAvg),
    needsReview: stats.reduce((x, s) => x + s.needsReview, 0),
    atRisk: profiles.filter((p) => p.atRisk).length,
  }
}

// Parses the per-sentence accuracy/completeness out of a stored GradeResult JSON.
export function parsePerSentence(aiResult: string | null | undefined): AnalyticsSubmission['perSentence'] {
  if (!aiResult) return []
  try {
    const parsed = JSON.parse(aiResult) as { perception?: { perSentence?: { order: number; accuracy: number; completeness: number }[] } }
    const ps = parsed?.perception?.perSentence
    if (!Array.isArray(ps)) return []
    return ps
      .filter((p) => typeof p?.order === 'number')
      .map((p) => ({ order: p.order, accuracy: Number(p.accuracy) || 0, completeness: Number(p.completeness) || 0 }))
  } catch {
    return []
  }
}
