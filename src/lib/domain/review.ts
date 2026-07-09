// 学期总评(成绩档案)——纯函数族。三类别(课堂表现/训练/期末)加权总评的全部算术都在这里:
// 工作台即时重算、发布快照、导出、学生档案页四处 import 同一份函数,口径永不分叉。
// 无 prisma/auth/i18n/Next;错误一律返回 i18n key 字符串。
//
// 设计要点(方案定稿,见 docs/SESSION-2026-07-09-RECOVERY.md 与 PR #437):
// - 草稿分数读时现算、不落库;只有发布落不可变快照(SemesterReviewPublish)。
// - 「训练」是一个类别,内部 5月/6月 两个子项各有可调占比(assignmentWeights,Σ=100)。
// - 缺数据口径:训练/期末的缺交子项按 missingZero 计 0(总评是全员定论,排除法会虚高缺交者);
//   课堂表现未导入 = 类别无数据(null),发布前须处理。
// - 老师类别级改分(override)优先于自动分;EXEMPT=免计,该类别权重按比例摊给其余类别。
// - 总评(total)不允许 override,永远由公式算。

export type ReviewCategoryKey = 'classroom' | 'training' | 'final'

export interface ReviewWeights {
  classroom: number
  training: number
  final: number
}

export interface ReviewConfig {
  v: 1
  weights: ReviewWeights // 整数百分比,Σ=100
  categories: {
    classroom: { classPerfImportId: number | null } // 钉住某次导入,再导入不漂移
    training: { assignmentIds: number[]; assignmentWeights: number[] } // 子项内部占比,整数,Σ=100
    final: { assignmentIds: number[] }
  }
  missingZero: boolean
}

export const DEFAULT_REVIEW_WEIGHTS: ReviewWeights = { classroom: 30, training: 30, final: 40 }

// 从课头作业列表推导默认配置:训练 = mode='TRAINING' 或 title 以「Native English 2000」开头;
// 期末 = title 以「期末考核」开头。「非正式作业」等其余 mode/title 一律不入总评(clark 有意排除),
// 老师可在工作台勾选修正。
export function defaultReviewConfig(
  assignments: { id: number; title: string; mode: string | null }[],
  classPerfImportId: number | null,
): ReviewConfig {
  const training = assignments.filter((a) => a.mode === 'TRAINING' || a.title.startsWith('Native English 2000'))
  const final = assignments.filter((a) => a.title.startsWith('期末考核'))
  const n = training.length
  // 子项内部默认等分(整数,余数给第一项,保 Σ=100;无子项时留空数组)。
  const evenShare = n > 0 ? Math.floor(100 / n) : 0
  const assignmentWeights = training.map((_, i) => (i === 0 ? 100 - evenShare * (n - 1) : evenShare))
  return {
    v: 1,
    weights: { ...DEFAULT_REVIEW_WEIGHTS },
    categories: {
      classroom: { classPerfImportId },
      training: { assignmentIds: training.map((a) => a.id), assignmentWeights },
      final: { assignmentIds: final.map((a) => a.id) },
    },
    missingZero: true,
  }
}

// 配置校验:错误返回 i18n key,合法返回 null。比例「自由设定」(clark 决定)——只强制
// 整数、非负、Σ=100;教学上限只作用于 AI 推荐(见 review-advice),不锁老师的手。
export function validateReviewConfig(cfg: ReviewConfig): string | null {
  const w = cfg.weights
  const parts = [w.classroom, w.training, w.final]
  if (parts.some((x) => !Number.isInteger(x) || x < 0 || x > 100)) return 'review.errWeightRange'
  if (parts.reduce((a, b) => a + b, 0) !== 100) return 'review.errWeightSum'
  const tw = cfg.categories.training.assignmentWeights
  const ids = cfg.categories.training.assignmentIds
  if (ids.length > 0) {
    if (tw.length !== ids.length) return 'review.errTrainingWeights'
    if (tw.some((x) => !Number.isInteger(x) || x < 0 || x > 100)) return 'review.errWeightRange'
    if (tw.reduce((a, b) => a + b, 0) !== 100) return 'review.errTrainingWeights'
  }
  return null
}

// ── 每生聚合 ────────────────────────────────────────────────────────────────────

// 输入是「已按既有口径合成的分」:训练/期末各作业分来自 analytics 的
// latestPhaseSubmissions→collapsePhases(finalScore 已含老师环节改分);课堂表现分来自
// domain/class-perf 的公式B。本模块不重复实现任何上游口径。
export interface StudentCategoryInputs {
  classroom: number | null // null = 该生无课堂表现数据(未导入/不在导入名单)
  trainingParts: (number | null)[] // 与 config.training.assignmentIds 对齐;null = 该次未交
  final: number | null // null = 期末未交
}

export interface CategoryAuto {
  classroom: number | null
  training: number | null
  final: number | null
  // 有子项被按缺交计 0(供发布预览列「计0名单」;课堂 null 不属此列,单独提示)。
  missingCounted: ReviewCategoryKey[]
}

export function categoryAuto(inputs: StudentCategoryInputs, cfg: ReviewConfig): CategoryAuto {
  const missing: ReviewCategoryKey[] = []
  // 训练:子项按 assignmentWeights 加权;缺交子项 missingZero→0(并记名单),否则跳过重归一。
  let training: number | null = null
  const ids = cfg.categories.training.assignmentIds
  if (ids.length > 0) {
    let sum = 0
    let wsum = 0
    let sawAny = false
    inputs.trainingParts.forEach((score, i) => {
      const w = cfg.categories.training.assignmentWeights[i] ?? 0
      if (score == null) {
        if (cfg.missingZero) {
          sum += 0 * w
          wsum += w
          if (!missing.includes('training')) missing.push('training')
        }
        return
      }
      sawAny = true
      sum += score * w
      wsum += w
    })
    training = wsum > 0 && (sawAny || cfg.missingZero) ? sum / wsum : null
  }
  // 期末:单作业;缺交 missingZero→0。
  let final: number | null = inputs.final
  if (final == null && cfg.categories.final.assignmentIds.length > 0 && cfg.missingZero) {
    final = 0
    missing.push('final')
  }
  return { classroom: inputs.classroom, training, final, missingCounted: missing }
}

// ── 改分/免计与总评 ─────────────────────────────────────────────────────────────

export interface OverrideInput {
  categoryKey: ReviewCategoryKey
  score: number | null // state=OVERRIDE 时必有;EXEMPT 为 null
  state: 'OVERRIDE' | 'EXEMPT'
}

export interface CategoryCell {
  auto: number | null
  override: number | null // 老师改分值(EXEMPT 时为 null)
  exempt: boolean
  fin: number | null // 生效分:EXEMPT→null;否则 override ?? auto
}

export type EffectiveCategories = Record<ReviewCategoryKey, CategoryCell>

export function effectiveCategories(auto: CategoryAuto, overrides: OverrideInput[]): EffectiveCategories {
  const byKey = new Map(overrides.map((o) => [o.categoryKey, o]))
  const cell = (key: ReviewCategoryKey, autoScore: number | null): CategoryCell => {
    const o = byKey.get(key)
    if (o?.state === 'EXEMPT') return { auto: autoScore, override: null, exempt: true, fin: null }
    const override = o?.score ?? null
    return { auto: autoScore, override, exempt: false, fin: override ?? autoScore }
  }
  return {
    classroom: cell('classroom', auto.classroom),
    training: cell('training', auto.training),
    final: cell('final', auto.final),
  }
}

// 总评 = Σ(生效分 × 权重)/Σ(参与权重)。EXEMPT 类别退出并把权重摊给其余(重归一);
// 非免计但 fin=null(如课堂未导入)按 0 计(发布前工作台会阻断/提示,这里保证算术总有定义)。
// 全部类别都免计 → null。round1。浏览器可 import(工作台滑杆即时重算用同一函数)。
export function computeTotal(cats: EffectiveCategories, weights: ReviewWeights): number | null {
  const entries: [ReviewCategoryKey, CategoryCell][] = [
    ['classroom', cats.classroom],
    ['training', cats.training],
    ['final', cats.final],
  ]
  let sum = 0
  let wsum = 0
  for (const [key, c] of entries) {
    if (c.exempt) continue
    const w = weights[key]
    sum += (c.fin ?? 0) * w
    wsum += w
  }
  if (wsum === 0) return null
  return round1((sum / wsum))
}

const round1 = (x: number) => Math.round(x * 10) / 10
const round2 = (x: number) => Math.round(x * 100) / 100

// ── 发布快照与班级聚合 ───────────────────────────────────────────────────────────

export interface SnapshotStudent {
  id: number
  no: string | null
  name: string | null
  cat: Record<ReviewCategoryKey, { auto: number | null; ovr: number | null; exempt: boolean; fin: number | null }>
  total: number | null
}

export interface AggBucket {
  n: number
  mean: number | null
  median: number | null
  p25: number | null
  p75: number | null
  hist10: number[] // 10 桶:0-9,10-19,…,90-100
}

export interface ReviewSnapshot {
  students: SnapshotStudent[]
  classAgg: { total: AggBucket } & Record<ReviewCategoryKey, AggBucket>
}

export function aggregate(values: (number | null)[]): AggBucket {
  const v = values.filter((x): x is number => x != null).sort((a, b) => a - b)
  const hist10 = Array.from({ length: 10 }, () => 0)
  for (const x of v) hist10[Math.min(9, Math.max(0, Math.floor(x / 10)))]++
  const q = (p: number) => (v.length === 0 ? null : v[Math.min(v.length - 1, Math.floor(p * (v.length - 1) + 0.5))])
  return {
    n: v.length,
    mean: v.length ? round2(v.reduce((a, b) => a + b, 0) / v.length) : null,
    median: q(0.5),
    p25: q(0.25),
    p75: q(0.75),
    hist10,
  }
}

export function assembleSnapshot(students: SnapshotStudent[]): ReviewSnapshot {
  const pick = (f: (s: SnapshotStudent) => number | null) => aggregate(students.map(f))
  return {
    students,
    classAgg: {
      total: pick((s) => s.total),
      classroom: pick((s) => s.cat.classroom.fin),
      training: pick((s) => s.cat.training.fin),
      final: pick((s) => s.cat.final.fin),
    },
  }
}

// 发布预览 diff:与上一已发布版逐生对比总评,并给出及格线(60)翻转名单——
// 修订再发布前强制过目(minors 公平护栏)。prev 为 null = 首次发布(全员视为新增)。
export interface PublishDiff {
  changed: { studentId: number; from: number | null; to: number | null }[]
  passFlips: { studentId: number; dir: 'pass->fail' | 'fail->pass' }[]
}

export function diffPublish(prev: ReviewSnapshot | null, next: ReviewSnapshot): PublishDiff {
  const prevBy = new Map((prev?.students ?? []).map((s) => [s.id, s.total]))
  const changed: PublishDiff['changed'] = []
  const passFlips: PublishDiff['passFlips'] = []
  for (const s of next.students) {
    const from = prevBy.has(s.id) ? (prevBy.get(s.id) ?? null) : null
    if (from !== s.total) changed.push({ studentId: s.id, from, to: s.total })
    const was = from != null && from >= 60
    const now = s.total != null && s.total >= 60
    if (prev && from != null && s.total != null && was !== now) {
      passFlips.push({ studentId: s.id, dir: was ? 'pass->fail' : 'fail->pass' })
    }
  }
  return { changed, passFlips }
}
