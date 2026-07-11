// 成绩档案树(domain,纯函数):把「作业 × 环节 × 提交统计」按
// 学期 → 任务类别(四态+未分类) → 任务(同批次跨班聚合) → 环节 → 班级 分组。
// 类别口径(clark 2026-07-11 定):Assignment.mode 四态(作业/训练/测评/考试),
// 无 mode 的老作业归「未分类」;课堂表现(雨课堂)与期末阶段总结由页面单独成块,
// 不进本函数(它们不是 Assignment)。
// 统计口径:已交 = 状态 ≠ DRAFT/MISSING;已评 = GRADED;均分 = GRADED 行的 finalScore 均值。

export interface ArchiveAssignmentRow {
  id: number
  batchId: string | null
  title: string
  mode: string | null
  dueAt: Date | null
  offering: {
    id: number
    year: string
    semester: string
    classId: number
    course: { name: string }
    class: { name: string }
  }
  phases: { id: number; order: number; title: string | null }[]
}

export interface PhaseStatRow {
  phaseId: number | null
  status: string
  _count: { _all: number }
  _avg: { finalScore: number | null }
}

export interface PhaseStat {
  submitted: number
  graded: number
  avg: number | null
}

// groupBy(phaseId,status) → 每环节一条合成统计。
export function combinePhaseStats(rows: PhaseStatRow[]): Map<number, PhaseStat> {
  const out = new Map<number, PhaseStat>()
  for (const r of rows) {
    if (r.phaseId == null) continue
    const s = out.get(r.phaseId) ?? { submitted: 0, graded: 0, avg: null }
    if (r.status !== 'DRAFT' && r.status !== 'MISSING') s.submitted += r._count._all
    if (r.status === 'GRADED') {
      s.graded += r._count._all
      s.avg = r._avg.finalScore == null ? null : Math.round(r._avg.finalScore * 10) / 10
    }
    out.set(r.phaseId, s)
  }
  return out
}

export interface ClassCell {
  offeringId: number
  assignmentId: number
  className: string
  size: number | null // 班级人数(分母);未知 null
  stat: PhaseStat | null // 该班该环节统计;无提交记录 null
}

export interface PhaseGroup {
  order: number
  title: string | null
  classes: ClassCell[]
}

export interface TaskGroup {
  key: string
  title: string
  dueAt: Date | null // 各班中最晚截止(展示用)
  classCount: number
  phases: PhaseGroup[]
}

export interface CategoryGroup {
  mode: string // HOMEWORK/TRAINING/ASSESSMENT/EXAM/OTHER
  tasks: TaskGroup[]
}

export interface SemesterGroup {
  year: string
  semester: string
  categories: CategoryGroup[]
}

const MODES = ['HOMEWORK', 'TRAINING', 'ASSESSMENT', 'EXAM'] as const
export const MODE_ORDER: string[] = [...MODES, 'OTHER']

const termKey = (y: string, s: string) => `${y}|${s}`

// 主分组:学期(新在前) → 类别(固定序) → 任务(同学期同类别内按 batchId,无批次按标题聚合,
// 最晚截止在前) → 环节(order 升序,标题取首见) → 班级(班名排序)。
export function buildTeacherArchive(
  rows: ArchiveAssignmentRow[],
  statsByPhase: Map<number, PhaseStat>,
  sizeByClassId: Map<number, number>,
): SemesterGroup[] {
  const byTerm = new Map<string, ArchiveAssignmentRow[]>()
  for (const r of rows) {
    const k = termKey(r.offering.year, r.offering.semester)
    const arr = byTerm.get(k) ?? []
    arr.push(r)
    byTerm.set(k, arr)
  }

  const terms = [...byTerm.keys()].sort().reverse()
  return terms.map((tk) => {
    const [year, semester] = tk.split('|')
    const termRows = byTerm.get(tk)!

    const categories: CategoryGroup[] = []
    for (const mode of MODE_ORDER) {
      const modeRows = termRows.filter((r) => (MODES as readonly string[]).includes(r.mode ?? '') ? r.mode === mode : mode === 'OTHER')
      if (modeRows.length === 0) continue

      // 任务聚合:batchId 优先(同一次「发一份勾多班」),无批次按标题(老数据同题跨班也该归一)。
      const byTask = new Map<string, ArchiveAssignmentRow[]>()
      for (const r of modeRows) {
        const k = r.batchId ? `b:${r.batchId}` : `t:${r.title}`
        const arr = byTask.get(k) ?? []
        arr.push(r)
        byTask.set(k, arr)
      }

      const tasks: TaskGroup[] = [...byTask.entries()].map(([key, group]) => {
        const dueAt = group.reduce<Date | null>((m, r) => (r.dueAt && (!m || r.dueAt > m) ? r.dueAt : m), null)
        // 环节骨架:各班实例的 order 并集(结构应一致,容忍个别班被单独改过)。
        const orders = [...new Set(group.flatMap((r) => r.phases.map((p) => p.order)))].sort((a, b) => a - b)
        const phases: PhaseGroup[] = orders.map((order) => {
          const title = group.flatMap((r) => r.phases).find((p) => p.order === order)?.title ?? null
          const classes: ClassCell[] = group
            .map((r) => {
              const phase = r.phases.find((p) => p.order === order)
              return {
                offeringId: r.offering.id,
                assignmentId: r.id,
                className: r.offering.class.name,
                size: sizeByClassId.get(r.offering.classId) ?? null,
                stat: phase ? (statsByPhase.get(phase.id) ?? { submitted: 0, graded: 0, avg: null }) : null,
              }
            })
            .sort((a, b) => a.className.localeCompare(b.className)) // 无该环节的班也保留(stat=null 显示 —)
          return { order, title, classes }
        })
        return { key, title: group[0].title, dueAt, classCount: group.length, phases }
      })
      tasks.sort((a, b) => (b.dueAt?.getTime() ?? 0) - (a.dueAt?.getTime() ?? 0))

      categories.push({ mode, tasks })
    }

    return { year, semester, categories }
  })
}

// ── 学生本人档案(学期 → 任务(按时间) → 环节分) ─────────────────────────────────

// listForStudentArchive 的行形(结构复述;phase/assignment 关联已带元数据)。
export interface StudentArchiveRow {
  studentId: number
  assignmentId: number
  phaseId: number | null
  status: string
  finalScore: number | null
  needsReview: boolean
  updatedAt: Date
  phase: { graded: boolean; weight: number; order: number; title: string | null } | null
  assignment: {
    id: number
    title: string
    mode: string | null
    dueAt: Date | null
    offering: { id: number; year: string; semester: string; course: { name: string }; class: { name: string } }
  }
}

export interface StudentPhaseCell {
  order: number
  title: string | null
  score: number | null
  status: string
  needsReview: boolean
  at: Date
}

export interface StudentTask {
  assignmentId: number
  title: string
  mode: string | null
  dueAt: Date | null
  course: string
  klass: string
  phases: StudentPhaseCell[]
  total: number | null // 与成绩单同一算术源(collapsePhases 加权),由调用方注入
}

export interface StudentSemester {
  year: string
  semester: string
  tasks: StudentTask[]
}

// 学生档案分组:学期(新在前) → 任务(最晚截止在前) → 环节(order 升序,每环节取最新 attempt,
// repo 已按 attempt desc 排,首见即最新)。total 由调用方用 collapsePhases 结果注入
// (同一算术源,见 review-load 的用法),本函数不重算总分。
export function buildStudentArchive(rows: StudentArchiveRow[], totalByAssignment: Map<number, number | null>): StudentSemester[] {
  const byTerm = new Map<string, Map<number, StudentArchiveRow[]>>()
  const seenPhase = new Set<string>()
  for (const r of rows) {
    const pk = `${r.assignmentId}:${r.phaseId ?? 0}`
    if (seenPhase.has(pk)) continue // attempt desc → 只留最新一次
    seenPhase.add(pk)
    const tk = termKey(r.assignment.offering.year, r.assignment.offering.semester)
    const tasks = byTerm.get(tk) ?? new Map<number, StudentArchiveRow[]>()
    const arr = tasks.get(r.assignmentId) ?? []
    arr.push(r)
    tasks.set(r.assignmentId, arr)
    byTerm.set(tk, tasks)
  }

  return [...byTerm.keys()]
    .sort()
    .reverse()
    .map((tk) => {
      const [year, semester] = tk.split('|')
      const tasks: StudentTask[] = [...byTerm.get(tk)!.values()].map((group) => {
        const a = group[0].assignment
        const phases: StudentPhaseCell[] = group
          .map((r) => ({
            order: r.phase?.order ?? 0,
            title: r.phase?.title ?? null,
            score: r.finalScore,
            status: r.status,
            needsReview: r.needsReview,
            at: r.updatedAt,
          }))
          .sort((x, y) => x.order - y.order)
        return {
          assignmentId: a.id,
          title: a.title,
          mode: a.mode,
          dueAt: a.dueAt,
          course: a.offering.course.name,
          klass: a.offering.class.name,
          phases,
          total: totalByAssignment.get(a.id) ?? null,
        }
      })
      tasks.sort((x, y) => (y.dueAt?.getTime() ?? 0) - (x.dueAt?.getTime() ?? 0))
      return { year, semester, tasks }
    })
}

