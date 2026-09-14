import { normalizeText } from '@/lib/grading/normalize'
import { isObjectiveType } from '@/lib/grading/objective'
import type { Item } from '@/lib/schema/paper'

// 学情统计(SPEC §8「学情分析」任务维度):每题正确率 / 得分率、前五常见错答、分大题得分率、
// 班级分布、学生 × 小题得分矩阵。纯函数:输入是已查好的行,输出可直接渲染或转 CSV。
// 「每题中位用时」需要客户端逐题计时埋点,首期无数据,不在此计算(PROGRESS 记录)。

export interface StatItem {
  id: string
  number: number
  type: string
  score: number
  sectionId: string
  sectionTitle: string
}
export interface StatStudent {
  userId: string
  name: string
  attemptId: string | null
  status: string // not_started | in_progress | submitted | graded | released
  totalScore: number | null
}
export interface StatResponse {
  attemptId: string
  itemId: string
  score: number | null
  verdict: string | null
  answerText: string
}

export interface ItemStat {
  itemId: string
  number: number
  type: string
  sectionTitle: string
  fullScore: number
  objective: boolean
  submitted: number // 已交卷人数(分母)
  answered: number // 非空作答
  correct: number // 客观题满分数
  pending: number // 主观题待评
  avgScore: number | null
  /** 客观题 = 正确人数 / 已交;主观题 = 平均分 / 满分 */
  rate: number | null
  topWrong: Array<{ answer: string; count: number }>
}
export interface SectionStat {
  sectionId: string
  title: string
  fullScore: number
  avgScore: number
  rate: number
}
export interface Distribution {
  submitted: number
  /** 已交但仍有待评小题的人数:他们的总分不完整,不进均值 / 中位 / 分档 */
  pendingStudents: number
  fullScore: number
  mean: number | null
  median: number | null
  max: number | null
  min: number | null
  /** 按满分百分比分档:<60、60–69、70–79、80–89、≥90 */
  bins: Array<{ label: string; count: number }>
}
export interface StudentRow {
  userId: string
  name: string
  status: string
  totalScore: number | null
  /** 已交但有小题待评(总分暂不完整) */
  pending: boolean
  scores: Array<number | null> // 与 items 同序;未交 / 未答为 null
}
export interface AssignmentStats {
  items: ItemStat[]
  sections: SectionStat[]
  distribution: Distribution
  students: StudentRow[]
  fullScore: number
}

const SUBMITTED = new Set(['submitted', 'graded', 'released'])

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const round1 = (x: number) => Math.round(x * 10) / 10

export function computeAssignmentStats(items: StatItem[], students: StatStudent[], responses: StatResponse[]): AssignmentStats {
  const submittedStudents = students.filter((s) => s.attemptId && SUBMITTED.has(s.status))
  const submittedAttempts = new Set(submittedStudents.map((s) => s.attemptId!))
  const byAttemptItem = new Map<string, StatResponse>()
  for (const r of responses) if (submittedAttempts.has(r.attemptId)) byAttemptItem.set(`${r.attemptId}|${r.itemId}`, r)

  const fullScore = items.reduce((n, it) => n + it.score, 0)
  // 每题未取整的平均分(分大题 / 得分率用它累加,只在展示值上取整,避免 0.1 的舍入累积)。
  const rawAvg = new Map<string, number>()
  const itemStats: ItemStat[] = items.map((it) => {
    const objective = isObjectiveType(it.type as Item['type'])
    let answered = 0
    let correct = 0
    let pending = 0
    let sum = 0
    const wrong = new Map<string, number>()
    for (const s of submittedStudents) {
      const r = byAttemptItem.get(`${s.attemptId}|${it.id}`)
      if (!r || r.answerText.trim() === '') {
        // 未作答按 0 分计入平均(分母是已交人数)
        continue
      }
      answered++
      if (r.score === null) {
        pending++
        continue
      }
      sum += r.score
      if (objective) {
        if (r.score >= it.score) correct++
        else {
          const key = normalizeText(r.answerText)
          if (key) wrong.set(key, (wrong.get(key) ?? 0) + 1)
        }
      }
    }
    const submitted = submittedStudents.length
    // 平均分:已判(含空答 0 分)/ (已交 − 待评)
    const denom = submitted - pending
    const avgRaw = denom > 0 ? sum / denom : null
    if (avgRaw !== null) rawAvg.set(it.id, avgRaw)
    const avgScore = avgRaw === null ? null : round1(avgRaw)
    const rate = objective ? (submitted > 0 ? correct / submitted : null) : avgRaw !== null && it.score > 0 ? avgRaw / it.score : null
    return {
      itemId: it.id,
      number: it.number,
      type: it.type,
      sectionTitle: it.sectionTitle,
      fullScore: it.score,
      objective,
      submitted,
      answered,
      correct,
      pending,
      avgScore,
      rate: rate === null ? null : Math.round(rate * 1000) / 1000,
      topWrong: [...wrong.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([answer, count]) => ({ answer, count })),
    }
  })

  const sectionMap = new Map<string, SectionStat & { n: number }>()
  for (const it of items) {
    const cur = sectionMap.get(it.sectionId) ?? { sectionId: it.sectionId, title: it.sectionTitle, fullScore: 0, avgScore: 0, rate: 0, n: 0 }
    cur.fullScore += it.score
    cur.avgScore += rawAvg.get(it.id) ?? 0
    sectionMap.set(it.sectionId, cur)
  }
  const sections: SectionStat[] = [...sectionMap.values()].map((s) => ({
    sectionId: s.sectionId,
    title: s.title,
    fullScore: s.fullScore,
    avgScore: round1(s.avgScore),
    rate: s.fullScore > 0 ? Math.round((s.avgScore / s.fullScore) * 1000) / 1000 : 0,
  }))

  // 有待评小题的学生总分不完整(待评按 0 计会把他们全压进低分档),不进分布;单独报人数。
  const hasPending = (s: StatStudent) => items.some((it) => byAttemptItem.get(`${s.attemptId}|${it.id}`)?.score === null && (byAttemptItem.get(`${s.attemptId}|${it.id}`)?.answerText.trim() ?? '') !== '')
  const complete = submittedStudents.filter((s) => !hasPending(s))
  const totals = complete.map((s) => s.totalScore ?? 0)
  const bins = [
    { label: '<60%', lo: 0, hi: 0.6 },
    { label: '60–69%', lo: 0.6, hi: 0.7 },
    { label: '70–79%', lo: 0.7, hi: 0.8 },
    { label: '80–89%', lo: 0.8, hi: 0.9 },
    { label: '≥90%', lo: 0.9, hi: Infinity },
  ].map((b) => ({ label: b.label, count: totals.filter((t) => (fullScore > 0 ? t / fullScore : 0) >= b.lo && (fullScore > 0 ? t / fullScore : 0) < b.hi).length }))
  const distribution: Distribution = {
    submitted: submittedStudents.length,
    pendingStudents: submittedStudents.length - complete.length,
    fullScore,
    mean: totals.length ? round1(totals.reduce((a, b) => a + b, 0) / totals.length) : null,
    median: median(totals),
    max: totals.length ? Math.max(...totals) : null,
    min: totals.length ? Math.min(...totals) : null,
    bins,
  }

  const studentRows: StudentRow[] = students.map((s) => ({
    userId: s.userId,
    name: s.name,
    status: s.status,
    totalScore: s.attemptId && SUBMITTED.has(s.status) ? s.totalScore : null,
    pending: !!s.attemptId && SUBMITTED.has(s.status) && hasPending(s),
    scores: items.map((it) => {
      if (!s.attemptId || !SUBMITTED.has(s.status)) return null
      const r = byAttemptItem.get(`${s.attemptId}|${it.id}`)
      if (!r || r.answerText.trim() === '') return 0
      return r.score
    }),
  }))

  return { items: itemStats, sections, distribution, students: studentRows, fullScore }
}

/** CSV 行(学生 × 小题矩阵 + 空行 + 每题统计)。 */
export function statsToCsvRows(stats: AssignmentStats, meta: { title: string; className: string }): unknown[][] {
  const head = ['学生', '状态', '总分', ...stats.items.map((it) => `${it.number}`)]
  const STATUS: Record<string, string> = { not_started: '未开始', in_progress: '作答中', submitted: '已交卷', graded: '已评分', released: '已发布' }
  const rows: unknown[][] = [[`${meta.title}（${meta.className}）`, `满分 ${stats.fullScore}`], head]
  for (const s of stats.students) rows.push([s.name, `${STATUS[s.status] ?? s.status}${s.pending ? '（有待评）' : ''}`, s.totalScore, ...s.scores.map((x) => (x === null ? '' : x))])
  rows.push([])
  rows.push(['题号', '大题', '题型', '满分', '已交', '作答', '正确 / 平均分', '正确率 / 得分率', '待评', '常见错答 1', '常见错答 2', '常见错答 3', '常见错答 4', '常见错答 5'])
  for (const it of stats.items) {
    rows.push([
      it.number,
      it.sectionTitle,
      it.type,
      it.fullScore,
      it.submitted,
      it.answered,
      it.objective ? it.correct : it.avgScore,
      it.rate === null ? '' : `${Math.round(it.rate * 100)}%`,
      it.pending,
      ...[0, 1, 2, 3, 4].map((i) => (it.topWrong[i] ? `${it.topWrong[i]!.answer}（${it.topWrong[i]!.count}）` : '')),
    ])
  }
  rows.push([])
  rows.push(['大题', '满分', '平均分', '得分率'])
  for (const s of stats.sections) rows.push([s.title, s.fullScore, s.avgScore, `${Math.round(s.rate * 100)}%`])
  rows.push([])
  rows.push(['分布', ...stats.distribution.bins.map((b) => b.label)])
  rows.push(['人数', ...stats.distribution.bins.map((b) => b.count)])
  rows.push(['已交', stats.distribution.submitted, '待评未计入', stats.distribution.pendingStudents, '平均', stats.distribution.mean ?? '', '中位', stats.distribution.median ?? '', '最高', stats.distribution.max ?? '', '最低', stats.distribution.min ?? ''])
  return rows
}
