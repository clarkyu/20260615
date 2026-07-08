import type { PrismaClient, Role, SubmissionStatus } from '@prisma/client'
import { offeringScopeFor } from './scope'
import { phaseItemType } from '@/lib/phase-item-type'

// Tenant-scoped data access for assignments. An assignment belongs to a school
// through its offering, so every scope check goes via `offering: offeringScopeFor(...)`
// (the shared staff-ownership filter in lib/repo/scope). A TEACHER may only reach their
// OWN offerings; a school/super admin reaches the whole school — same rule on the list
// views AND every by-id read/write (no IDOR by guessing ids).

export interface SentenceRow {
  order: number
  text: string
  translation?: string | null
}

// Assignment-level (shared by all phases): identity + scheduling label. The category
// (作业类型) lives per-phase now; the assignment's column mirrors phase 1. `mode` is the
// 作业性质「四态」(HOMEWORK/TRAINING/ASSESSMENT/EXAM) — optional so omitting it (undefined)
// leaves the stored value untouched on update paths that don't carry it.
export interface AssignmentMeta {
  title: string
  monthLabel: string | null
  mode?: string | null
}

// One ordered 环节 (phase) of an assignment: its own type (category), content (bank set
// or typed sentences), submission requirements, time window, attempts, and whether it
// counts toward the grade. `graded: false` = practice-only. Sentences come resolved.
export interface PhaseInput {
  id: number | null // existing phase id (edit) — null for a newly added phase
  order: number
  title: string | null
  category: string | null
  instructions: string | null
  chunkSetId: number | null
  shadowVideoKey: string | null
  openAt: Date | null
  dueAt: Date | null
  requireEyesClosed: boolean
  requireText: boolean
  requireAudio: boolean
  requireVideo: boolean
  requireHandwriting: boolean
  requireChoice?: boolean
  choicesJson?: string | null
  correctChoice?: string | null
  multiChoice?: boolean
  correctChoices?: string | null
  selectionMode?: string | null
  branchTopicsJson?: string | null
  fillBlank?: boolean
  blanksJson?: string | null
  requireFreeText?: boolean
  rubric?: string | null
  perceptionModel?: string | null
  judgeModel?: string | null
  graded: boolean
  maxAttempts: number
  weight: number
  isFormalTest: boolean
  freePractice: boolean
  sentences: SentenceRow[]
}

// The assignment's legacy columns mirror its FIRST phase, so the (still
// phase-unaware) student + grading pipeline keeps working unchanged — a single-phase
// assignment is byte-for-byte what it was before phases existed.
function legacyColumnsFromPrimary(p: PhaseInput) {
  return {
    category: p.category,
    instructions: p.instructions,
    chunkSetId: p.chunkSetId,
    shadowVideoKey: p.shadowVideoKey,
    openAt: p.openAt,
    dueAt: p.dueAt,
    requireEyesClosed: p.requireEyesClosed,
    requireText: p.requireText,
    requireAudio: p.requireAudio,
    requireVideo: p.requireVideo,
    requireHandwriting: p.requireHandwriting,
    maxAttempts: p.maxAttempts,
  }
}

export function findForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.assignment.findFirst({ where: { id, offering: offeringScopeFor(schoolId, userId, role) } })
}

// The teacher who owns this assignment's offering + their default grading models —
// used to resolve BYOK keys and the per-teacher default model in one query.
export async function offeringTeacher(prisma: PrismaClient, assignmentId: number) {
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { offering: { select: { schoolId: true, teacherId: true, teacher: { select: { defaultPerceptionModel: true, defaultJudgeModel: true } } } } },
  })
  const o = a?.offering
  return o ? { schoolId: o.schoolId, teacherId: o.teacherId, defaultPerceptionModel: o.teacher.defaultPerceptionModel, defaultJudgeModel: o.teacher.defaultJudgeModel } : null
}

// The grading screen: assignment + offering(course/class) + every submission with
// its student, ordered so the latest attempt per student comes first.
// 提交行用显式 select、只取页面实际消费的字段——一份作业动辄数百行提交(全 attempt),
// 而 include 会连 aiResult/transcript 这类单行数 KB 的评阅大字段一起搬,评分页每次
// 打开/每次评分点击都要为此白读 MB 级数据(复查 R5,10–20× 过度)。新增消费字段时
// 在这里补 select,tsc 会替你把关。
export function findDetailForStaff(prisma: PrismaClient, id: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.assignment.findFirst({
    where: { id, offering: offeringScopeFor(schoolId, userId, role) },
    select: {
      id: true, title: true, category: true, rubric: true, offeringId: true,
      _count: { select: { sentences: true } },
      offering: { include: { course: true, class: { select: { id: true, name: true } } } },
      phases: { orderBy: { order: 'asc' }, select: { id: true, order: true, title: true, graded: true, requireVideo: true, requireAudio: true, requireChoice: true, choicesJson: true, correctChoice: true, multiChoice: true, correctChoices: true, requireFreeText: true, rubric: true, defaultPerceptionModel: true, defaultJudgeModel: true, _count: { select: { sentences: true } } } },
      submissions: {
        orderBy: [{ studentId: 'asc' }, { attempt: 'desc' }],
        select: {
          id: true, studentId: true, phaseId: true, attempt: true, status: true, needsReview: true,
          aiScore: true, finalScore: true, feedback: true, recitedText: true, voteSourceText: true,
          videoKey: true, audioKey: true, imageKey: true, durationSec: true, violations: true,
          student: { select: { name: true, studentNo: true } },
          phase: { select: { order: true, title: true } },
        },
      },
    },
  })
}

// Teacher "preview as student", phase-aware: assignment + ordered phases, each with
// its sentences and (for shadow phases) chunk-set chunks. School-scoped, no submissions.
export function findForStaffPreviewPhases(prisma: PrismaClient, id: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.assignment.findFirst({
    where: { id, offering: offeringScopeFor(schoolId, userId, role) },
    include: {
      phases: {
        orderBy: { order: 'asc' },
        include: {
          sentences: { orderBy: { order: 'asc' } },
          chunkSet: { include: { chunks: { orderBy: { order: 'asc' } } } },
        },
      },
    },
  })
}

// The Phase column data shared by create + update (everything except id/sentences).
function phaseData(p: PhaseInput) {
  return {
    order: p.order,
    title: p.title,
    category: p.category,
    instructions: p.instructions,
    chunkSetId: p.chunkSetId,
    shadowVideoKey: p.shadowVideoKey,
    openAt: p.openAt,
    dueAt: p.dueAt,
    requireEyesClosed: p.requireEyesClosed,
    requireText: p.requireText,
    requireAudio: p.requireAudio,
    requireVideo: p.requireVideo,
    requireHandwriting: p.requireHandwriting,
    requireChoice: p.requireChoice ?? false,
    choicesJson: p.choicesJson ?? null,
    correctChoice: p.correctChoice ?? null,
    multiChoice: p.multiChoice ?? false,
    correctChoices: p.correctChoices ?? null,
    selectionMode: p.selectionMode ?? null,
    branchTopicsJson: p.branchTopicsJson ?? null,
    fillBlank: p.fillBlank ?? false,
    blanksJson: p.blanksJson ?? null,
    requireFreeText: p.requireFreeText ?? false,
    // Explicit type discriminator, derived from the submit-requirement flags by the one
    // source of truth (lib/phase-item-type) — kept consistent with migration 0042's
    // backfill so the stored column and the runtime derivation never disagree.
    itemType: phaseItemType(p),
    rubric: p.rubric ?? null,
    defaultPerceptionModel: p.perceptionModel ?? null,
    defaultJudgeModel: p.judgeModel ?? null,
    graded: p.graded,
    maxAttempts: p.maxAttempts,
    weight: p.weight,
    isFormalTest: p.isFormalTest,
    freePractice: p.freePractice,
  }
}

// Create the Phase rows (+ their sentences) for an assignment. Each phase is a
// standalone create so D1 can resolve its autoincrement id for the nested sentence
// inserts (interactive/batched transactions can't on D1).
async function createPhases(prisma: PrismaClient, assignmentId: number, phases: PhaseInput[]) {
  for (const p of phases) {
    await prisma.phase.create({
      data: {
        assignmentId,
        ...phaseData(p),
        sentences: { create: p.sentences.map((s) => ({ assignmentId, order: s.order, text: s.text, translation: s.translation ?? null })) },
      },
    })
  }
}

// One create per offering. Writes the assignment (legacy columns mirror phase 1) and
// its ordered phases. `phases` must be non-empty with `order` 1..n.
export async function createWithPhases(prisma: PrismaClient, offeringId: number, meta: AssignmentMeta, phases: PhaseInput[], batchId: string | null = null) {
  const assignment = await prisma.assignment.create({
    data: { offeringId, batchId, ...meta, ...legacyColumnsFromPrimary(phases[0]) },
  })
  await createPhases(prisma, assignment.id, phases)
  return assignment
}

// Which of the given offerings ALREADY have an assignment from this publish batch. Makes
// publishing idempotent: a double-clicked / retried submit carrying the same client-
// generated batchId skips the offerings it already created instead of duplicating them.
export async function offeringsWithBatch(prisma: PrismaClient, batchId: string, offeringIds: number[]): Promise<Set<number>> {
  const rows = await prisma.assignment.findMany({
    where: { batchId, offeringId: { in: offeringIds } },
    select: { offeringId: true },
  })
  return new Set(rows.map((r) => r.offeringId))
}

// The merge pre-check: which of the requested assignments the actor actually owns, and
// each one's course (归并只允许同课程 — the domain layer enforces it on these rows).
export function listCourseIdsForMerge(prisma: PrismaClient, ids: number[], schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.assignment.findMany({
    where: { id: { in: ids }, offering: offeringScopeFor(schoolId, userId, role) },
    select: { id: true, batchId: true, offering: { select: { courseId: true } } },
  })
}

// 归并批次: stamp the given assignments with one shared (fresh) batchId + a unified title,
// so the staff list groups them as a single per-class expandable card. Scoped like every
// other staff write; `version + 1` fences any in-flight edit form (its stale save then
// conflicts cleanly instead of silently reverting the unified title).
export async function mergeIntoBatch(prisma: PrismaClient, ids: number[], schoolId: number | null | undefined, userId: number, role: Role, batchId: string, title: string): Promise<number> {
  const res = await prisma.assignment.updateMany({
    where: { id: { in: ids }, offering: offeringScopeFor(schoolId, userId, role) },
    data: { batchId, title, version: { increment: 1 } },
  })
  return res.count
}

// ── 环节统一为单选投票（维护工具,CRON_SECRET 路由专用） ─────────────────────────
// 平台级读(无 actor scope,由 CRON_SECRET 把门),但**必须钉学校**:作业标题全平台
// 不唯一,不带 schoolId 会把别校恰好同名的作业一并扫进目标(复查 R6)。
export function listPhaseGroupForUnify(prisma: PrismaClient, schoolId: number, title: string, order: number) {
  return prisma.phase.findMany({
    where: { order, assignment: { title, offering: { schoolId } } },
    select: {
      id: true, order: true, requireText: true, requireChoice: true, requireFreeText: true,
      requireAudio: true, requireVideo: true, requireHandwriting: true, fillBlank: true,
      multiChoice: true, correctChoice: true, correctChoices: true, choicesJson: true, itemType: true,
      assignment: { select: { id: true, title: true, offering: { select: { class: { select: { name: true } } } } } },
      submissions: {
        where: { status: { not: 'DRAFT' } },
        select: { id: true, studentId: true, attempt: true, recitedText: true, status: true, needsReview: true, finalScore: true, student: { select: { name: true, studentNo: true } } },
      },
    },
  })
}

// 老师自助「统一题型到本投票环节」的源环节读(staff scoped):环节 + 其作业/授课定位字段。
export function findPhaseForUnifySource(prisma: PrismaClient, phaseId: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.phase.findFirst({
    where: { id: phaseId, assignment: { offering: offeringScopeFor(schoolId, userId, role) } },
    select: {
      id: true, order: true, requireText: true, requireChoice: true, multiChoice: true,
      correctChoice: true, choicesJson: true, fillBlank: true, requireAudio: true, requireVideo: true,
      assignment: { select: { id: true, title: true, batchId: true, offering: { select: { courseId: true, classId: true } } } },
    },
  })
}

// 兄弟作业同序环节(候选统一目标),识别口径与 findSyncSiblings 一致:同批次 batchId 或
// 同课程同标题、不同班,本人 scope。带回配置 + 非草稿提交,供 domain 侧筛选与出报告。
export function listSiblingPhasesForUnify(
  prisma: PrismaClient,
  source: { assignmentId: number; order: number; courseId: number; classId: number; batchId: string | null; title: string },
  schoolId: number | null | undefined,
  userId: number,
  role: Role,
) {
  return prisma.phase.findMany({
    where: {
      order: source.order,
      assignment: {
        id: { not: source.assignmentId },
        offering: { ...offeringScopeFor(schoolId, userId, role), courseId: source.courseId, classId: { not: source.classId } },
        OR: [...(source.batchId ? [{ batchId: source.batchId }] : []), { title: source.title }],
      },
    },
    select: {
      id: true, order: true, requireText: true, requireChoice: true, requireFreeText: true,
      requireAudio: true, requireVideo: true, requireHandwriting: true, fillBlank: true,
      multiChoice: true, correctChoice: true, correctChoices: true, choicesJson: true, itemType: true,
      assignment: { select: { id: true, title: true, offering: { select: { class: { select: { name: true } } } } } },
      submissions: {
        where: { status: { not: 'DRAFT' } },
        select: { id: true, studentId: true, attempt: true, recitedText: true, status: true, needsReview: true, finalScore: true, student: { select: { name: true, studentNo: true } } },
      },
    },
  })
}

// 把一个默写文本环节改型为单选投票(套用模板班的选项),itemType 同步 objective——
// 存储列与 phaseItemType 推导必须一致。order=1 时同步 Assignment 上的 legacy 镜像列
// (与 updateWithPhases 的 legacyColumnsFromPrimary 行为对齐);作业 version+1 围栏在途编辑。
export async function convertPhaseToPoll(prisma: PrismaClient, phaseId: number, assignmentId: number, isPrimary: boolean, choicesJson: string) {
  await prisma.phase.update({
    where: { id: phaseId },
    data: {
      requireText: false, requireChoice: true, multiChoice: false,
      correctChoice: null, correctChoices: null, choicesJson, itemType: 'objective',
    },
  })
  await prisma.assignment.update({
    where: { id: assignmentId },
    data: { ...(isPrimary ? { requireText: false } : {}), version: { increment: 1 } },
  })
}

// 编辑批次:批内所有成员统一改名 + 定性质(mode 四态,null = 清除)。Scoped;
// `version + 1` 围栏在途编辑表单(同 mergeIntoBatch 的理由)。batchId(可选)由 domain
// 在目标是 legacy 组(全员无 batchId)时铸新传入——改名后组的身份从「课程+标题」变成
// 稳定的 batchId,不再与同名 legacy 组融合、卡片 key 也不再随标题漂移(复查 R9)。
export async function updateBatchMeta(prisma: PrismaClient, ids: number[], schoolId: number | null | undefined, userId: number, role: Role, data: { title: string; mode: string | null; batchId?: string }): Promise<number> {
  const res = await prisma.assignment.updateMany({
    where: { id: { in: ids }, offering: offeringScopeFor(schoolId, userId, role) },
    data: { title: data.title, mode: data.mode, ...(data.batchId ? { batchId: data.batchId } : {}), version: { increment: 1 } },
  })
  return res.count
}

// Edit an assignment's phases, RECONCILING by phase id so a phase the teacher kept is
// updated in place — never deleted-and-recreated. This is critical: Submission /
// PracticeAttempt cascade-delete with their Phase, so deleting a phase would destroy
// every student's graded work. So: update kept phases in place (replacing only their
// sentences), create newly-added phases, and delete only phases the teacher removed
// (which intentionally drops that phase's submissions).
export type UpdateOutcome = { ok: true } | { ok: false; conflict: true }

export async function updateWithPhases(
  prisma: PrismaClient,
  id: number,
  meta: AssignmentMeta,
  phases: PhaseInput[],
  knownPhaseIds: readonly number[],
  expectedVersion: number,
): Promise<UpdateOutcome> {
  // Optimistic-lock fence: atomically claim the version. If the assignment was edited by
  // someone else since this form loaded (version moved), count === 0 → bail BEFORE touching
  // any phase, so a stale save can't overwrite their edit or cascade-delete submissions. The
  // meta write + version bump ride the same statement so the claim is a single atomic act.
  const claimed = await prisma.assignment.updateMany({
    where: { id, version: expectedVersion },
    data: { ...meta, ...legacyColumnsFromPrimary(phases[0]), version: { increment: 1 } },
  })
  if (claimed.count === 0) return { ok: false, conflict: true }

  const existing = await prisma.phase.findMany({ where: { assignmentId: id }, select: { id: true } })
  const existingIds = new Set(existing.map((p) => p.id))
  const keptIds = new Set(phases.map((p) => p.id).filter((x): x is number => x != null && existingIds.has(x)))
  // The phases this edit actually LOADED. A phase now in the DB but NOT here was added
  // concurrently (another tab, the 复习作业 builder) after the form loaded — it must never be
  // counted as "removed", or a stale save would cascade-delete its student submissions. This
  // stays as a safety net for any phase-add path that doesn't bump the version.
  const known = new Set(knownPhaseIds)

  for (const p of phases) {
    if (p.id != null && existingIds.has(p.id)) {
      // Update in place + replace its sentences (sentences have no children to cascade).
      await prisma.$transaction([
        prisma.phase.update({ where: { id: p.id }, data: phaseData(p) }),
        prisma.sentence.deleteMany({ where: { phaseId: p.id } }),
        prisma.sentence.createMany({ data: p.sentences.map((s) => ({ assignmentId: id, phaseId: p.id, order: s.order, text: s.text, translation: s.translation ?? null })) }),
      ])
    } else {
      await createPhases(prisma, id, [p])
    }
  }

  // Delete only phases the edit LOADED and the teacher then dropped — never a phase added
  // concurrently that the form never saw (audit P2-9: a stale save must not destroy the
  // submissions of a phase it didn't know about). Fail-safe: with no known ids, delete none.
  const removed = existing.filter((p) => known.has(p.id) && !keptIds.has(p.id)).map((p) => p.id)
  if (removed.length > 0) await prisma.phase.deleteMany({ where: { id: { in: removed } } })
  return { ok: true }
}

// The edit screen: assignment + its ordered phases, each with sentences + chunk-set name.
// Persist a phase's 批阅配置（评分标准 + 感知/评分模型）. Scoped to the staff member's
// own offerings via assignment.offering — a TEACHER can only touch their own phases.
export function updatePhaseGradingConfig(
  prisma: PrismaClient,
  phaseId: number,
  schoolId: number | null | undefined,
  userId: number,
  role: Role,
  data: { rubric: string | null; defaultPerceptionModel: string | null; defaultJudgeModel: string | null },
) {
  return prisma.phase.updateMany({
    where: { id: phaseId, assignment: { offering: offeringScopeFor(schoolId, userId, role) } },
    data,
  })
}

// The teacher's OTHER classes' copies of "the same assignment" — the grading screen
// offers to sync a phase's 评阅配置 to them. Matched two ways so BOTH new and legacy work:
//  · shared publish batchId — assignments published together via one "发一份 + 勾多班";
//  · same title within the same course — covers already-published (legacy) assignments
//    that predate batchId, or any republished copy.
// One per other class (newest wins), teacher-scoped. Returns the specific sibling
// assignment id so applying is by explicit id (no ambiguity if a class has two).
export async function findSyncSiblings(prisma: PrismaClient, assignmentId: number, schoolId: number | null | undefined, userId: number, role: Role): Promise<{ assignmentId: number; offeringId: number; className: string }[]> {
  const self = await prisma.assignment.findFirst({
    where: { id: assignmentId, offering: offeringScopeFor(schoolId, userId, role) },
    select: { title: true, batchId: true, offering: { select: { courseId: true, classId: true } } },
  })
  if (!self) return []
  const rows = await prisma.assignment.findMany({
    where: {
      id: { not: assignmentId },
      offering: { ...offeringScopeFor(schoolId, userId, role), classId: { not: self.offering.classId }, courseId: self.offering.courseId },
      // 有批次身份的作业只按 batchId 认亲:同名兜底仅留给无 batchId 的 legacy 作业。
      // 否则改名/归并后撞上同课程的无关同名作业,会被默认勾选进「同步评阅配置」,
      // 一次保存静默改写别人作业的评分标准/模型(复查 R9);要认亲请先归并批次。
      OR: self.batchId ? [{ batchId: self.batchId }] : [{ title: self.title }],
    },
    select: { id: true, offeringId: true, offering: { select: { class: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
  })
  // One per other class: rows are newest-first, so keep the first seen per offering.
  const byOffering = new Map<number, { assignmentId: number; offeringId: number; className: string }>()
  for (const r of rows) if (!byOffering.has(r.offeringId)) byOffering.set(r.offeringId, { assignmentId: r.id, offeringId: r.offeringId, className: r.offering.class.name })
  return [...byOffering.values()].sort((a, b) => a.className.localeCompare(b.className))
}

// Apply a phase's 评阅配置 to the SAME-ORDER phases of the given sibling ASSIGNMENTS
// (chosen from findSyncSiblings). Scoped: only the teacher's own offerings — a teacher
// can't reach another class/teacher's phases. Explicit assignment ids ⇒ no ambiguity.
// Returns the number of sibling phases updated.
export async function applyPhaseConfigToSiblings(
  prisma: PrismaClient,
  phaseId: number,
  schoolId: number | null | undefined,
  userId: number,
  role: Role,
  targetAssignmentIds: number[],
  data: { rubric: string | null; defaultPerceptionModel: string | null; defaultJudgeModel: string | null },
): Promise<number> {
  if (targetAssignmentIds.length === 0) return 0
  const src = await prisma.phase.findFirst({
    where: { id: phaseId, assignment: { offering: offeringScopeFor(schoolId, userId, role) } },
    select: { order: true },
  })
  if (!src) return 0
  const res = await prisma.phase.updateMany({
    where: {
      order: src.order,
      assignment: { id: { in: targetAssignmentIds }, offering: offeringScopeFor(schoolId, userId, role) },
    },
    data,
  })
  return res.count
}

export function findForStaffWithPhases(prisma: PrismaClient, id: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.assignment.findFirst({
    where: { id, offering: offeringScopeFor(schoolId, userId, role) },
    include: {
      phases: {
        orderBy: { order: 'asc' },
        include: {
          sentences: { orderBy: { order: 'asc' } },
          chunkSet: { select: { id: true, name: true, shadowVideoKey: true, _count: { select: { chunks: true } } } },
        },
      },
    },
  })
}

// A bare review assignment (默认音频背诵、可多次) seeded from the picked sentences — one
// graded phase.
export function createReview(prisma: PrismaClient, offeringId: number, title: string, sentences: SentenceRow[]) {
  return createWithPhases(prisma, offeringId, { title, monthLabel: null }, [
    {
      id: null,
      order: 1,
      title: null,
      category: '复习作业',
      instructions: null,
      chunkSetId: null,
      shadowVideoKey: null,
      openAt: null,
      dueAt: null,
      requireEyesClosed: false,
      requireText: false,
      requireAudio: true,
      requireVideo: false,
      requireHandwriting: false,
      graded: true,
      maxAttempts: 3,
      weight: 1,
      isFormalTest: false,
      freePractice: false,
      sentences,
    },
  ])
}

// Delete iff it belongs to the school; returns the offering id (for redirect) or null.
export async function deleteForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined, userId: number, role: Role): Promise<number | null> {
  const found = await prisma.assignment.findFirst({ where: { id, offering: offeringScopeFor(schoolId, userId, role) }, select: { offeringId: true } })
  if (!found) return null
  await prisma.assignment.delete({ where: { id } })
  return found.offeringId
}

// Assignments of an offering as {id, title}, oldest first — the gradebook columns.
export function listForOfferingBrief(prisma: PrismaClient, offeringId: number) {
  return prisma.assignment.findMany({ where: { offeringId }, select: { id: true, title: true }, orderBy: { createdAt: 'asc' } })
}

// ── the staff "作业" menu: every assignment in the actor's scope ──────────────────
const NEEDS_TEACHER: SubmissionStatus[] = ['UPLOADED', 'FLAGGED', 'GRADED', 'FAILED']

// id-list (`in:`) queries chunk at ≤90 ids: D1 caps bound parameters at 100/query
// (复查 R12;同 domain/roster 的导入分块)。Chunks partition the ids, so per-chunk
// results never overlap and can be merged by concatenation.
const ID_CHUNK = 90
function idChunks(ids: number[]): number[][] {
  const out: number[][] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) out.push(ids.slice(i, i + ID_CHUNK))
  return out
}

// The newest `limit` assignments the staff member can see, with course/class, due
// date, and phase count. Bounded (复查 R12): the 作业 menu shows recent work; older
// assignments stay reachable per class via the teaching pages. Callers fetch limit+1
// to detect truncation.
export function listForStaff(prisma: PrismaClient, schoolId: number | null | undefined, userId: number, role: Role, limit: number) {
  return prisma.assignment.findMany({
    where: { offering: offeringScopeFor(schoolId, userId, role) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, title: true, category: true, mode: true, dueAt: true, monthLabel: true, batchId: true,
      offering: { select: { courseId: true, course: { select: { name: true } }, class: { select: { name: true } } } },
      _count: { select: { phases: true } },
    },
  })
}

// How many DISTINCT students have submitted (any phase) per assignment — counts
// students, not per-phase submission rows, so a multi-phase assignment isn't inflated
// (20 students × 3 phases must read 20, not 60). Only the given assignments are
// scanned (复查 R12: the menu is bounded, so its counts must not walk the teacher's
// whole submission history either).
export async function submittedCountByAssignment(prisma: PrismaClient, schoolId: number | null | undefined, userId: number, role: Role, assignmentIds: number[]): Promise<Map<number, number>> {
  // GROUP BY (assignmentId, studentId) dedups a student's multiple attempts/phases IN SQL
  // and ships only the distinct pairs — whereas Prisma `distinct` on the D1 adapter fetches
  // every matching row and dedups in the query engine (the 作业 menu re-scanned a teacher's
  // whole submission history on each load). Then count distinct students per assignment.
  const m = new Map<number, number>()
  for (const ids of idChunks(assignmentIds)) {
    const pairs = await prisma.submission.groupBy({
      by: ['assignmentId', 'studentId'],
      where: { assignmentId: { in: ids }, status: { not: 'DRAFT' }, assignment: { offering: offeringScopeFor(schoolId, userId, role) } },
    })
    for (const p of pairs) m.set(p.assignmentId, (m.get(p.assignmentId) ?? 0) + 1)
  }
  return m
}

// Pending-review count per assignment (the actionable chip on the 作业 menu),
// restricted to the given assignments (复查 R12).
export async function pendingReviewByAssignment(prisma: PrismaClient, schoolId: number | null | undefined, userId: number, role: Role, assignmentIds: number[]): Promise<Map<number, number>> {
  const m = new Map<number, number>()
  for (const ids of idChunks(assignmentIds)) {
    const groups = await prisma.submission.groupBy({
      by: ['assignmentId'],
      where: { assignmentId: { in: ids }, needsReview: true, status: { in: NEEDS_TEACHER }, assignment: { offering: offeringScopeFor(schoolId, userId, role) } },
      _count: { _all: true },
    })
    for (const g of groups) m.set(g.assignmentId, g._count._all)
  }
  return m
}

// Non-DRAFT submission count per PHASE of one assignment — the edit form uses it to
// warn before removing a phase that already has student submissions (removing it
// cascade-deletes those). System-scoped by assignmentId (the caller already scoped the
// assignment to the staff member).
export async function submittedCountByPhase(prisma: PrismaClient, assignmentId: number): Promise<Map<number, number>> {
  const groups = await prisma.submission.groupBy({
    by: ['phaseId'],
    where: { assignmentId, status: { not: 'DRAFT' } },
    _count: { _all: true },
  })
  const m = new Map<number, number>()
  for (const g of groups) if (g.phaseId != null) m.set(g.phaseId, g._count._all)
  return m
}

// Each assignment's sentences {phaseId, order, text} — the insights weak-line map
// (keyed per phase, since orders repeat across phases).
export function listForOfferingTitled(prisma: PrismaClient, offeringId: number) {
  return prisma.assignment.findMany({
    where: { offeringId },
    select: { id: true, title: true, sentences: { select: { phaseId: true, order: true, text: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

// Sentences of every assignment in an offering (for the "weakest sentence" review),
// carrying phaseId so the review picks the right phase's text.
export function listWithSentencesForOffering(prisma: PrismaClient, offeringId: number) {
  return prisma.assignment.findMany({
    where: { offeringId },
    select: { id: true, sentences: { select: { phaseId: true, order: true, text: true, translation: true } } },
  })
}

// ── student-facing reads (scoped to the student's class, not their school) ────

// The student home list: the assignments of all the student's classes, each with
// the student's latest submission, sentence count, and course name. Fetch the top 2
// attempts (not 1): a redo creates an in-progress DRAFT above the submitted attempt, so
// the caller picks the representative via `representativeSubmission` (latest non-DRAFT).
export function listForStudent(prisma: PrismaClient, classIds: number[], studentId: number) {
  return prisma.assignment.findMany({
    where: { offering: { classId: { in: classIds } } },
    orderBy: { createdAt: 'desc' },
    include: {
      offering: { include: { course: { select: { name: true } } } },
      phases: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          graded: true,
          _count: { select: { sentences: true } },
          submissions: { where: { studentId }, orderBy: { attempt: 'desc' }, take: 2, select: { status: true, finalScore: true, feedback: true, recitedText: true, gradedAt: true } },
        },
      },
    },
  })
}

// ── per-phase student reads (a phase is the unit a student submits to) ──────────

// The phase iff it belongs to one of the student's classes (the submission gate),
// carrying its time window, attempt cap, owning assignment, and submit requirements.
export function findPhaseForClasses(prisma: PrismaClient, phaseId: number, classIds: number[]) {
  return prisma.phase.findFirst({
    where: { id: phaseId, assignment: { offering: { classId: { in: classIds } } } },
    select: {
      id: true, assignmentId: true, openAt: true, dueAt: true, maxAttempts: true, freePractice: true,
      requireText: true, requireVideo: true, requireAudio: true, requireHandwriting: true,
      requireChoice: true, choicesJson: true, correctChoice: true, multiChoice: true, correctChoices: true, fillBlank: true, blanksJson: true, requireFreeText: true,
      branchTopicsJson: true, // 甲·分流门:提交前判定本环节是否属于该学生所选主题
      // the owning offering — denormalized onto each new Submission so per-offering reads use the index
      assignment: { select: { offeringId: true } },
    },
  })
}

// 选题落地(维护):按 school+title+order 圈定「纯选择环节」(requireChoice + 无答案键),供
// set-selection-mode 把它标成 theme/branch(把历史「投票 hack」正式升格为选题)。只认无答案键的,
// 避免误改客观判分题(有 correctChoice/correctChoices 的单/多选题)。
export function findSelectionModeTargets(prisma: PrismaClient, schoolId: number, title: string, order: number) {
  return prisma.phase.findMany({
    where: {
      order,
      requireChoice: true,
      assignment: { title, offering: { schoolId } },
      AND: [
        { OR: [{ correctChoice: null }, { correctChoice: '' }] },
        { OR: [{ correctChoices: null }, { correctChoices: '' }] },
      ],
    },
    select: { id: true, selectionMode: true, assignmentId: true },
  })
}

// 把一批环节的 selectionMode 设成给定值(选题落地)。分块避 D1 绑定上限。只写 Phase,绝不碰 Submission。
export async function setPhaseSelectionModeByIds(prisma: PrismaClient, ids: number[], mode: string | null): Promise<number> {
  const CHUNK = 100
  let count = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const r = await prisma.phase.updateMany({ where: { id: { in: ids.slice(i, i + CHUNK) } }, data: { selectionMode: mode } })
    count += r.count
  }
  return count
}

// 环节 rubric 落地(维护):按 school+title+order 圈定环节(任意类型,不筛 requireChoice——评分标准
// 落在写作/口语环节上),供 set-phase-rubric 批量写评分标准 + 参照来源 + 合规开关。带回当前值供 dry-run 核对。
export function findPhaseRubricTargets(prisma: PrismaClient, schoolId: number, title: string, order: number) {
  return prisma.phase.findMany({
    where: { order, assignment: { title, offering: { schoolId } } },
    select: { id: true, assignmentId: true, itemType: true, rubric: true, referenceSource: true, complianceScoring: true },
  })
}

// 把一批环节的评分标准 / 参照来源 / 合规开关设成给定值(rubric 落地)。只带上明确给了的字段(部分更新),
// 分块避 D1 绑定上限。只写 Phase,绝不碰 Submission / 评分结果。
export async function setPhaseRubricByIds(
  prisma: PrismaClient,
  ids: number[],
  data: { rubric?: string; referenceSource?: string | null; complianceScoring?: boolean },
): Promise<number> {
  const CHUNK = 100
  let count = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const r = await prisma.phase.updateMany({ where: { id: { in: ids.slice(i, i + CHUNK) } }, data })
    count += r.count
  }
  return count
}

export function findPhaseShadowVideoForClasses(prisma: PrismaClient, phaseId: number, classIds: number[]) {
  return prisma.phase.findFirst({
    where: { id: phaseId, assignment: { offering: { classId: { in: classIds } } } },
    select: { shadowVideoKey: true },
  })
}

// A phase + its ordered sentences (+ the assignment's rubric/models) — the practice gate.
export function findPhaseWithSentencesForClasses(prisma: PrismaClient, phaseId: number, classIds: number[]) {
  return prisma.phase.findFirst({
    where: { id: phaseId, assignment: { offering: { classId: { in: classIds } } } },
    include: {
      sentences: { orderBy: { order: 'asc' } },
      assignment: { select: { id: true, rubric: true, defaultPerceptionModel: true, defaultJudgeModel: true } },
    },
  })
}

export function countPhaseSentences(prisma: PrismaClient, phaseId: number) {
  return prisma.sentence.count({ where: { phaseId } })
}

// The phases (submit type + rubric + sentence count) of a set of assignments — the batch
// list shows a batch's 内容/评分标准 from its representative assignment. Keyed by caller
// via assignmentId. Ordered by phase order (per chunk; chunks are consumed keyed, not by
// global order).
export async function listPhaseSummariesForAssignments(prisma: PrismaClient, assignmentIds: number[]) {
  const out = []
  for (const ids of idChunks(assignmentIds)) {
    out.push(...await prisma.phase.findMany({
      where: { assignmentId: { in: ids } },
      orderBy: [{ assignmentId: 'asc' }, { order: 'asc' }],
      select: {
        assignmentId: true, order: true, title: true, rubric: true, graded: true,
        requireVideo: true, requireAudio: true, requireText: true, requireHandwriting: true,
        requireChoice: true, requireFreeText: true, fillBlank: true,
        _count: { select: { sentences: true } },
      },
    }))
  }
  return out
}

// Sentence text for a set of assignments, keyed later by (assignmentId, phaseId, order)
// — used to join the student's weak-sentence aggregate back to readable text.
export function listSentencesForAssignments(prisma: PrismaClient, assignmentIds: number[]) {
  if (assignmentIds.length === 0) return Promise.resolve([])
  return prisma.sentence.findMany({
    where: { assignmentId: { in: assignmentIds } },
    select: { assignmentId: true, phaseId: true, order: true, text: true },
  })
}

// The assignment's phases as an overview list for the student: each phase's label,
// schedule, whether it counts, sentence count, and the student's latest submission
// status/score. Drives the multi-phase landing screen.
export function findForStudentPhaseList(prisma: PrismaClient, id: number, classIds: number[], studentId: number) {
  return prisma.assignment.findFirst({
    where: { id, offering: { classId: { in: classIds } } },
    include: {
      offering: { include: { course: { select: { name: true } } } },
      phases: {
        orderBy: { order: 'asc' },
        include: {
          _count: { select: { sentences: true } },
          // Top 2 attempts so a redo's in-progress DRAFT can't shadow the submitted one
          // (see representativeSubmission); the checklist picks the latest non-DRAFT.
          // recitedText: 甲·分流要读学生在「选题·分流」环节里选的题目(= 分流依据)。
          submissions: { where: { studentId }, orderBy: { attempt: 'desc' }, take: 2, select: { status: true, finalScore: true, recitedText: true } },
        },
      },
    },
  })
}

// One phase with everything its submit screen needs: its content (sentences + bank
// chunk set), the owning assignment's title/category, and the student's submissions
// for this phase (latest first, with shadow-take orders).
export function findPhaseDetailForStudent(prisma: PrismaClient, phaseId: number, classIds: number[], studentId: number) {
  return prisma.phase.findFirst({
    where: { id: phaseId, assignment: { offering: { classId: { in: classIds } } } },
    include: {
      sentences: { orderBy: { order: 'asc' } },
      chunkSet: { include: { chunks: { orderBy: { order: 'asc' } } } },
      assignment: { select: { id: true, title: true, category: true } },
      submissions: { where: { studentId }, orderBy: { attempt: 'desc' }, include: { shadowTakes: { select: { order: true, aiScore: true, spokenText: true } } } },
    },
  })
}
