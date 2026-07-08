import type { PrismaClient, SubmissionStatus, Role } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { offeringScopeFor } from './scope'

// Submission data access. A submission belongs to a school through assignment.offering;
// staff reads/writes are scoped by the shared staff-ownership filter (lib/repo/scope)
// nested under assignment.offering — a TEACHER only reaches their OWN offerings'
// submissions, an admin the whole school.
const staffSub = (schoolId: number | null | undefined, userId: number, role: Role) =>
  ({ assignment: { offering: offeringScopeFor(schoolId, userId, role) } })

// One submission the staff member may grade, with its assignment + ordered
// reference sentences (everything autoGradeSubmission needs).
export function findForStaff(prisma: PrismaClient, id: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.submission.findFirst({
    where: { id, ...staffSub(schoolId, userId, role) },
    include: {
      phase: { include: { sentences: { orderBy: { order: 'asc' } } } },
      assignment: { include: { sentences: { orderBy: { order: 'asc' } } } },
    },
  })
}

// One student's own submissions, trimmed to what the points tally needs
// (status / score / dates). Own-data read — no school scope required.
export function listForStudentPoints(prisma: PrismaClient, studentId: number) {
  return prisma.submission.findMany({
    where: { studentId },
    select: { status: true, finalScore: true, gradedAt: true, createdAt: true },
  })
}

export function listShadowTakes(prisma: PrismaClient, submissionId: number) {
  return prisma.shadowTake.findMany({
    where: { submissionId },
    orderBy: { order: 'asc' },
    select: { order: true, audioKey: true, aiScore: true, spokenText: true },
  })
}

// 归票:把一份提交的作答改写为某个选项的规范原文(投票分布按 recitedText 与选项精确
// 匹配计票)。needsReview 一并清掉——投票环节不进复核列表,留着会变成幽灵计数。
// voteSourceText 归票留痕(原始作答,undefined = 不动该列):有它即可无损撤销。
// 维护工具与 staff 路径都由调用方先做 scope/合法性校验,再按 id 写入。
export function setPollAnswer(prisma: PrismaClient, id: number, choice: string, voteSourceText?: string | null) {
  return prisma.submission.update({
    where: { id },
    data: { recitedText: choice, needsReview: false, ...(voteSourceText !== undefined ? { voteSourceText } : {}) },
  })
}

// 撤销归票:作答恢复为归票留痕的原文,清掉留痕。调用方先校验 scope + 留痕存在。
export function revertPollAnswer(prisma: PrismaClient, id: number, originalText: string) {
  return prisma.submission.update({ where: { id }, data: { recitedText: originalText, voteSourceText: null } })
}

// 批量归票的前置读(staff scoped):一组提交 + 各自环节的投票配置。越权的 id 直接
// 查不出来(数量不齐 → 调用方整体拒绝)。草稿/缺交同责(复查 R19):草稿学生还在改、
// 本就不计票;缺交没有作答,归票等于凭空造票。工作台不列这两类,只有伪造/过期请求会带进来。
export function listPollAssignables(prisma: PrismaClient, ids: number[], schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.submission.findMany({
    where: { id: { in: ids }, status: { notIn: ['DRAFT', 'MISSING'] }, ...staffSub(schoolId, userId, role) },
    select: {
      id: true, assignmentId: true, recitedText: true, voteSourceText: true,
      phase: { select: { id: true, requireChoice: true, multiChoice: true, correctChoice: true, choicesJson: true } },
    },
  })
}

// ── 评阅补登(维护,平台级按 schoolId+标题 钉租户;见 domain/grading-backfill) ────

// 写作补评候选:写作型环节上 已提交/已标记、尚无 AI 分、文本非空的行——AI 文本评分
// 上线前就提交、从未入队的那批(期末考核复盘)。已评(GRADED)/缺交/草稿/卡处理中的
// 一律不碰;有 AI 分的说明评过,也不重评。
export function listWritingBackfillCandidates(prisma: PrismaClient, schoolId: number, title: string) {
  return prisma.submission.findMany({
    where: {
      status: { in: ['UPLOADED', 'FLAGGED'] },
      aiScore: null,
      NOT: [{ recitedText: null }, { recitedText: '' }],
      assignment: { title, offering: { schoolId } },
      phase: { itemType: 'writing' },
    },
    select: { id: true, assignmentId: true },
  })
}

// 媒体探针目标(维护读,平台级按 schoolId+标题 钉租户):还等着评阅、但带着视频指针的
// 行——评阅失败/卡处理中/未评,以及标记了却没有 AI 分的。id 游标分页:探测要对每个
// 对象发一次网络请求,Workers 免费档每请求 ≤50 子请求,必须分批。
export function listMediaProbeTargets(prisma: PrismaClient, schoolId: number, title: string, afterId: number, limit: number) {
  return prisma.submission.findMany({
    where: {
      id: { gt: afterId },
      videoKey: { not: null },
      assignment: { title, offering: { schoolId } },
      OR: [
        { status: { in: ['FAILED', 'PROCESSING', 'UPLOADED'] } },
        { status: 'FLAGGED', aiScore: null },
      ],
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true, videoKey: true, durationSec: true, status: true, phase: { select: { order: true } } },
  })
}

// 逐句跟读(shadow)重评目标:逐句音频存在 ShadowTake 行里,不在 videoKey/audioKey——所以
// listMediaProbeTargets 完全看不到它们(期末收官清扫的盲区,163 份真背诵被漏在死信里)。这里
// 按 school+title 圈定、状态同口径(失败/卡死/未评/标记却无分),且必须至少有一条 ShadowTake
// (真有录音),排除空提交。id 游标分页。
export function listShadowGradingTargets(prisma: PrismaClient, schoolId: number, title: string, afterId: number, limit: number) {
  return prisma.submission.findMany({
    where: {
      id: { gt: afterId },
      shadowTakes: { some: {} }, // 有逐句录音才算目标,空提交不碰
      assignment: { title, offering: { schoolId } },
      OR: [
        { status: { in: ['FAILED', 'PROCESSING', 'UPLOADED'] } },
        { status: 'FLAGGED', aiScore: null },
      ],
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true, phase: { select: { order: true } } },
  })
}

// 上传坏死归档目标:评阅任务卡住/失败(GradingJob.status ∈ FAILED/PENDING/PROCESSING 且
// attempts≥1——即「至少试评过一次仍没成」)的提交,按 school+title 圈定,带上探测所需的媒体键
// (整段 video/audio + 逐句 ShadowTake 音频)与任务类别。resolveMissingMedia 逐个探测,确认
// 「无内容可评」(所有必需媒体皆空/缺)的才归档为缺交——健康的/判不准的一律不碰。
// 为何不只看 FAILED 死信:坏死的行会在 死信→重排(PENDING)→再评(PROCESSING)→再死信 之间循环,
// 只盯 FAILED 会漏掉此刻恰好在 PENDING/PROCESSING 的那些(尤其逐句被重跑后卡在 PENDING)。
// attempts≥1 守卫排除「刚提交、还没试评」的新行(它的媒体可能还在最终一致中,别误判)。
// 已归档(MISSING)的排除,保证重跑幂等。cap 60/次,more 续跑。
export function listStuckGradingTargets(prisma: PrismaClient, schoolId: number, title: string, limit = 60) {
  return prisma.submission.findMany({
    where: {
      status: { not: 'MISSING' },
      gradingJob: { status: { in: ['FAILED', 'PENDING', 'PROCESSING'] }, attempts: { gte: 1 } },
      assignment: { title, offering: { schoolId } },
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: {
      id: true,
      videoKey: true,
      audioKey: true,
      gradingJob: { select: { kind: true } },
      shadowTakes: { select: { audioKey: true } },
    },
  })
}

// 幽灵复核:**纯投票**环节(无答案键)上 needsReview=1 的行。投票不进复核队列,这些是
// 历史遗留,只虚增看板「待批」数。谓词必须钉死「无答案键」——带答案键的单选在答案键
// 缺失/损坏时会**刻意**落 needsReview 转人工(actions/submissions 的客观判分回退),
// 那是正路,不能误清;填空同理排除。
const ghostPollReviewWhere = (schoolId: number, title: string) => ({
  needsReview: true,
  assignment: { title, offering: { schoolId } },
  phase: {
    requireChoice: true,
    fillBlank: false,
    AND: [
      { OR: [{ correctChoice: null }, { correctChoice: '' }] },
      { OR: [{ correctChoices: null }, { correctChoices: '' }, { correctChoices: '[]' }] },
    ],
  },
})

export function countGhostPollReview(prisma: PrismaClient, schoolId: number, title: string) {
  return prisma.submission.count({ where: ghostPollReviewWhere(schoolId, title) })
}

export function clearGhostPollReview(prisma: PrismaClient, schoolId: number, title: string) {
  return prisma.submission.updateMany({ where: ghostPollReviewWhere(schoolId, title), data: { needsReview: false } })
}

// 环节改型为投票后的清理:该环节全部提交退出复核队列(投票不复核;不清会出现
// 待批徽章数得到、评分列表看不见的幽灵)。
export function clearNeedsReviewForPhase(prisma: PrismaClient, phaseId: number) {
  return prisma.submission.updateMany({ where: { phaseId, needsReview: true }, data: { needsReview: false } })
}

// Teacher manual override — their score is final, no further review needed.
export function applyTeacherOverride(
  prisma: PrismaClient,
  id: number,
  data: { teacherScore: number; finalScore: number; feedback: string | null; gradedById: number },
) {
  return prisma.submission.update({
    where: { id },
    data: { ...data, status: 'GRADED', needsReview: false, gradedAt: new Date() },
  })
}

// Apply the same teacher score and/or feedback to many submissions in one write
// (school-scoped). A score → marks them GRADED; feedback-only just sets the text.
export function applyBatchOverride(
  prisma: PrismaClient,
  ids: number[],
  schoolId: number | null | undefined,
  userId: number,
  role: Role,
  opts: { score: number | null; feedback: string | null; gradedById: number; at: Date },
) {
  const data: Prisma.SubmissionUpdateManyMutationInput = {
    ...(opts.score != null
      ? { teacherScore: opts.score, finalScore: opts.score, status: 'GRADED', needsReview: false, gradedById: opts.gradedById, gradedAt: opts.at }
      : {}),
    ...(opts.feedback != null ? { feedback: opts.feedback } : {}),
  }
  // Teacher-scoped: this is a direct id-list mutation with no prior ownership gate, so the
  // teacherId filter here IS the access boundary (a teacher can't override another
  // teacher's submissions by passing their ids).
  return prisma.submission.updateMany({
    where: { id: { in: ids }, ...staffSub(schoolId, userId, role) },
    data,
  })
}

// Bulk "trust the AI on the rest" for an assignment. A scoped raw UPDATE because
// updateMany can't copy aiScore→finalScore:
//  - COALESCE(teacherScore, aiScore): never clobber a score a teacher already set.
//  - exclude FLAGGED (anti-cheat) rows: those must stay for manual review.
//  - bind a JS Date (not CURRENT_TIMESTAMP) so the encoding matches Prisma's DateTime.
export function acceptAiForAssignment(prisma: PrismaClient, assignmentId: number, graderId: number, now: Date) {
  return prisma.$executeRaw`
    UPDATE "Submission"
       SET "finalScore" = COALESCE("teacherScore", "aiScore"),
           "needsReview" = 0,
           "status" = 'GRADED',
           "gradedById" = ${graderId},
           "gradedAt" = ${now}
     WHERE "assignmentId" = ${assignmentId}
       AND "needsReview" = 1
       AND "aiScore" IS NOT NULL
       AND "status" <> 'FLAGGED'`
}

// Submissions for an assignment by a set of students, newest attempt first — the
// caller keeps the latest per student (score export). Excludes DRAFT so an
// in-progress retry can't hide the student's already-submitted/graded attempt.
// Per-PHASE: one row per submitted phase attempt, latest-first within each phase, with
// the phase's order/title/graded so the caller can aggregate per (student, assignment).
export function listForAssignmentStudents(prisma: PrismaClient, assignmentId: number, studentIds: number[]) {
  return prisma.submission.findMany({
    where: { assignmentId, studentId: { in: studentIds }, status: { not: 'DRAFT' } },
    include: { phase: { select: { order: true, title: true, graded: true, weight: true } } },
    orderBy: [{ studentId: 'asc' }, { phaseId: 'asc' }, { attempt: 'desc' }],
  })
}

// Analytics row: the LATEST non-DRAFT attempt per (student, assignment, phase), with its
// phase.graded/weight. Shape mirrors domain analytics' RawPhaseRow.
export interface OfferingPhaseRow {
  studentId: number
  assignmentId: number
  phaseId: number | null
  status: string
  finalScore: number | null
  needsReview: boolean
  aiResult: string | null
  phase: { graded: boolean; weight: number } | null
}

// The latest non-DRAFT attempt per (student, assignment, PHASE) in an offering — analytics
// only ever uses the latest, so a window function (ROW_NUMBER … WHERE rn=1) returns just those
// rows. That fetches each (potentially large) aiResult blob ONCE instead of for every
// superseded attempt — the aiResult over-fetch fix. The primary filter is still the denormalized
// offeringId; the offeringScopeFor tenant fence is checked once via EXISTS on the offering, so
// the read is safe-by-construction even if a caller forgets to resolve the offering first (P2-8).
export async function listForOfferingLatestFirst(prisma: PrismaClient, offeringId: number, schoolId: number | null | undefined, userId: number, role: Role): Promise<OfferingPhaseRow[]> {
  const teacherFence = role === 'TEACHER' ? Prisma.sql`AND o."teacherId" = ${userId}` : Prisma.empty
  const rows = await prisma.$queryRaw<Array<{
    studentId: number; assignmentId: number; phaseId: number | null; status: string
    finalScore: number | null; needsReview: number | boolean; aiResult: string | null
    phaseGraded: number | boolean | null; phaseWeight: number | null
  }>>(Prisma.sql`
    SELECT s."studentId", s."assignmentId", s."phaseId", s."status", s."finalScore", s."needsReview", s."aiResult",
           p."graded" AS "phaseGraded", p."weight" AS "phaseWeight"
    FROM (
      SELECT "studentId", "assignmentId", "phaseId", "status", "finalScore", "needsReview", "aiResult",
             ROW_NUMBER() OVER (PARTITION BY "studentId", "assignmentId", "phaseId" ORDER BY "attempt" DESC) AS rn
      FROM "Submission"
      WHERE "offeringId" = ${offeringId} AND "status" <> 'DRAFT'
        AND EXISTS (SELECT 1 FROM "CourseOffering" o WHERE o."id" = ${offeringId} AND o."schoolId" = ${schoolId ?? -1} ${teacherFence})
    ) s
    LEFT JOIN "Phase" p ON p."id" = s."phaseId"
    WHERE s.rn = 1
    ORDER BY s."assignmentId", s."phaseId"
  `)
  return rows.map((r) => ({
    studentId: r.studentId,
    assignmentId: r.assignmentId,
    phaseId: r.phaseId,
    status: r.status,
    finalScore: r.finalScore,
    needsReview: Boolean(r.needsReview),
    aiResult: r.aiResult,
    phase: r.phaseId != null ? { graded: Boolean(r.phaseGraded), weight: r.phaseWeight ?? 1 } : null,
  }))
}

// AI-vs-teacher score pairs for an offering — only submissions a teacher actually
// re-scored (both an AI score and a teacher score present). Feeds the grading
// calibration insight; scoped by offering like the other analytics lists.
export function listScorePairsForOffering(prisma: PrismaClient, offeringId: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.submission.findMany({
    where: { offeringId, aiScore: { not: null }, teacherScore: { not: null }, ...staffSub(schoolId, userId, role) },
    select: { aiScore: true, teacherScore: true },
  })
}

// School-wide AI-vs-teacher score pairs for the admin calibration card, each carrying its
// offering's teacher so the page can derive BOTH the school-wide number and the per-teacher
// breakdown from one query. Same "both scores present" filter, scoped to the whole school
// via assignment.offering.schoolId (admin-only surface — every offering in the school).
// Bounded to corrections since `since` (by gradedAt): keeps the scan off ever-growing
// history AND makes the signal reflect the AI's RECENT behavior, not stale corrections
// from a since-retired model.
export function listScorePairsForSchool(prisma: PrismaClient, schoolId: number | null | undefined, since: Date) {
  return prisma.submission.findMany({
    where: {
      assignment: { offering: { schoolId: schoolId ?? -1 } },
      aiScore: { not: null },
      teacherScore: { not: null },
      gradedAt: { gte: since },
    },
    select: {
      aiScore: true,
      teacherScore: true,
      assignment: { select: { offering: { select: { teacherId: true, teacher: { select: { name: true } } } } } },
    },
  })
}

// Lighter variant for the gradebook export: it collapses phases and never needs the
// per-sentence detail, so the (potentially large) aiResult JSON is omitted — keeping the
// whole-offering scan cheap in memory even for a big class. Same ordering/dedup contract.
export function listForOfferingGradebook(prisma: PrismaClient, offeringId: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.submission.findMany({
    where: { offeringId, status: { not: 'DRAFT' }, ...staffSub(schoolId, userId, role) },
    select: { studentId: true, assignmentId: true, phaseId: true, status: true, finalScore: true, needsReview: true, phase: { select: { graded: true, weight: true } } },
    orderBy: [{ studentId: 'asc' }, { assignmentId: 'asc' }, { phaseId: 'asc' }, { attempt: 'desc' }],
  })
}

// Mark a set of non-submitting students as 缺交 (MISSING) for an assignment — one row
// per student on the given phase, no score. Caller passes only students who currently
// have no submission, so the (assignment, phase, student, attempt) unique key is safe.
export function createMissingMarkers(prisma: PrismaClient, params: { assignmentId: number; offeringId: number; phaseId: number; studentIds: number[]; gradedById: number; at: Date }) {
  return prisma.submission.createMany({
    data: params.studentIds.map((studentId) => ({
      assignmentId: params.assignmentId,
      offeringId: params.offeringId,
      phaseId: params.phaseId,
      studentId,
      attempt: 1,
      status: 'MISSING' as const,
      needsReview: false,
      gradedById: params.gradedById,
      gradedAt: params.at,
    })),
  })
}

// 把一批提交归档为缺交(MISSING,无分、不进复核)。上传坏死、无内容可评的提交归档后自动落出
// 看板「已交/待批/失败」各计数(MISSING 全 codebase 当作未提交处理),老师零操作。feedback 留痕
// 归档原因。分块写以避开 D1 绑定参数上限。ids 由调用方从已 scope 的查询取得。
export async function markSubmissionsMissing(prisma: PrismaClient, ids: number[], feedback: string): Promise<number> {
  const CHUNK = 40
  let n = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const r = await prisma.submission.updateMany({
      where: { id: { in: ids.slice(i, i + CHUNK) } },
      data: { status: 'MISSING', needsReview: false, feedback },
    })
    n += r.count
  }
  return n
}

// How many of a student's graded submissions are newer than they've seen — drives the
// in-app "new score" red dot. `since` null → everything graded is new.
export function countNewlyGraded(prisma: PrismaClient, studentId: number, since: Date | null) {
  return prisma.submission.count({
    where: { studentId, status: 'GRADED', gradedAt: since ? { gt: since } : { not: null } },
  })
}

// One student's own non-DRAFT submissions in the analytics (RawPhaseRow) shape —
// powers the student's personal 「我的薄弱点」 profile. Latest attempt first per phase.
export function listForStudentLatestFirst(prisma: PrismaClient, studentId: number) {
  return prisma.submission.findMany({
    where: { studentId, status: { not: 'DRAFT' } },
    select: { studentId: true, assignmentId: true, phaseId: true, status: true, finalScore: true, needsReview: true, aiResult: true, phase: { select: { graded: true, weight: true } }, assignment: { select: { title: true } } },
    orderBy: [{ assignmentId: 'asc' }, { phaseId: 'asc' }, { attempt: 'desc' }],
  })
}

// One student's non-DRAFT submissions within ONE offering (RawPhaseRow shape) — for
// the teacher's per-student drill-down. Scoped by assignment.offeringId.
export function listForStudentInOfferingLatestFirst(prisma: PrismaClient, offeringId: number, studentId: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.submission.findMany({
    where: { studentId, status: { not: 'DRAFT' }, offeringId, ...staffSub(schoolId, userId, role) },
    select: { studentId: true, assignmentId: true, phaseId: true, status: true, finalScore: true, needsReview: true, aiResult: true, phase: { select: { graded: true, weight: true } }, assignment: { select: { title: true } } },
    orderBy: [{ assignmentId: 'asc' }, { phaseId: 'asc' }, { attempt: 'desc' }],
  })
}

// ── grading pipeline (the AI grading state machine; called by the job queue /
//    grading services, keyed by submission id — system-wide, not tenant-scoped) ──

// The reference sentences + eyes-closed flag a grader scores against come from the
// submission's PHASE (each phase owns its own content). The assignment is still
// included for the rubric / pinned models / owning teacher; sentences fall back to
// the assignment for any legacy row without a phase.
const gradingInclude = {
  phase: { include: { sentences: { orderBy: { order: 'asc' as const } } } },
  assignment: { include: { sentences: { orderBy: { order: 'asc' as const } } } },
}

// One submission to auto-grade, with its phase/assignment + ordered reference sentences.
// Submissions whose recording media is older than `cutoff` — the retention sweep target.
// Bounded by `limit` so a scheduled run processes a predictable batch.
export function listExpiredMedia(prisma: PrismaClient, cutoff: Date, limit: number) {
  return prisma.submission.findMany({
    where: { createdAt: { lt: cutoff }, OR: [{ videoKey: { not: null } }, { audioKey: { not: null } }, { imageKey: { not: null } }] },
    select: { id: true, videoKey: true, audioKey: true, imageKey: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
}

// Null the named media pointers once their objects are deleted, so nothing points at a gone
// file. The retention sweep clears only the keys whose R2 object it actually removed, so one
// key whose delete keeps failing can't re-block clearing the siblings that are already gone.
export function clearMediaKeys(prisma: PrismaClient, id: number, cols: readonly ('videoKey' | 'audioKey' | 'imageKey')[]) {
  const data: { videoKey?: null; audioKey?: null; imageKey?: null } = {}
  for (const c of cols) data[c] = null
  return prisma.submission.update({ where: { id }, data })
}

// Per-sentence shadow-take recordings older than `cutoff`. The retention sweep deletes
// the take row + its audio; the submission keeps its overall grade.
export function listExpiredShadowTakes(prisma: PrismaClient, cutoff: Date, limit: number) {
  return prisma.shadowTake.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, audioKey: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
}

export function deleteShadowTake(prisma: PrismaClient, id: number) {
  return prisma.shadowTake.delete({ where: { id } })
}

export function findGradable(prisma: PrismaClient, id: number) {
  return prisma.submission.findUnique({ where: { id }, include: gradingInclude })
}

// Same, plus the per-sentence shadow takes (for the shadowing grader).
export function findGradableShadow(prisma: PrismaClient, id: number) {
  return prisma.submission.findUnique({
    where: { id },
    include: { ...gradingInclude, shadowTakes: { orderBy: { order: 'asc' } } },
  })
}

// Unconditional entry transition. Used ONLY by the manual, teacher-triggered grade
// (runGrading) — an explicit human action that is authoritative and may re-grade a row
// in any state.
export function markProcessing(prisma: PrismaClient, id: number) {
  return prisma.submission.update({ where: { id }, data: { status: 'PROCESSING' } })
}

// 一次评阅运行的合理寿命上限:PROCESSING 超过它即视为死运行遗留(单次评分远短于此)。
export const PROCESSING_STALE_MS = 15 * 60 * 1000

// GUARDED entry claim for BACKGROUND (durable-queue) runs. Only reopens a still-gradeable
// submission (UPLOADED / FLAGGED); returns count 0 when a teacher (or another run) already
// finalized it in the race window between the grader's status read and this claim. The
// background run must bail on count 0 — otherwise an unconditional reopen (→ PROCESSING)
// would let its later fenced applyGradeResult silently overwrite the teacher's manual grade.
//
// 卡死回收(期末考核复盘):运行中途死掉会把提交永远留在 PROCESSING,而本认领原来只认
// UPLOADED/FLAGGED——这样的行从此无法被后台重评(claim 陷阱,生产一度积压 217 份)。
// 现在允许接管 updatedAt 已过期的 PROCESSING 行;活跃运行会持续更新行(认领本身就会
// bump updatedAt),不会被抢。
//
// FAILED 也可认领(复盘续:requeue 只重置 GradingJob→PENDING、提交仍 FAILED,而本函数
// 原来不认 FAILED → 后台评阅认领 count=0、返回「成功但没评」→ 任务永远退回 PENDING 空转,
// 232 份卡死死循环、lastError 全 null)。队列里存在 PENDING 任务本就是「要重评」的显式信号,
// 提交是 FAILED 恰说明该重试。GRADED(老师已定稿或 AI 成功)不在列 → 绝不重开、不覆盖。
export function claimForProcessing(prisma: PrismaClient, id: number) {
  return prisma.submission.updateMany({
    where: {
      id,
      OR: [
        { status: { in: ['UPLOADED', 'FLAGGED', 'FAILED'] } },
        { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - PROCESSING_STALE_MS) } },
      ],
    },
    data: { status: 'PROCESSING' },
  })
}

// Terminal grading writes are FENCED to `status: 'PROCESSING'` (the state markProcessing
// set): only the run that still owns the submission commits. So a concurrent teacher
// override (→ GRADED) or a double-run reclaim can't be clobbered — whoever finalizes
// first wins, the loser's write matches no row.
export function markFailed(prisma: PrismaClient, id: number) {
  return prisma.submission.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'FAILED', needsReview: true } })
}

// Model unavailable / nothing to grade — back to the teacher queue (keep FLAGGED).
export function revertToQueue(prisma: PrismaClient, id: number, status: SubmissionStatus) {
  return prisma.submission.updateMany({ where: { id, status: 'PROCESSING' }, data: { status, needsReview: true } })
}

export interface GradeResult {
  status: SubmissionStatus
  needsReview: boolean
  confidence: number | null
  perceptionModel: string
  judgeModel: string
  transcript: string
  aiResult: string
  aiScore: number
  finalScore: number
  feedback: string
  gradedById: number | null
  // Real usage/cost of this grade (null when the providers didn't report usage).
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  costMicroUsd: number | null // integer µUSD — the bill-grade cost column (usage aggregates on this)
}

// Persist the perception result mid-grade — after perceive succeeds, BEFORE judge runs.
// Fenced to PROCESSING so only the owning run writes. If the grade then fails at judge, this
// cached perception survives on the (FAILED) row, so the durable-queue retry reuses it and
// skips the expensive re-perceive instead of re-billing Gemini for the same video.
export function savePerception(prisma: PrismaClient, id: number, perceptionJson: string) {
  return prisma.submission.updateMany({ where: { id, status: 'PROCESSING' }, data: { perceptionJson } })
}

// Fenced to PROCESSING (see markFailed): a late AI write never overwrites a teacher
// override or a faster concurrent run. Clears the mid-grade perception cache — the finalized
// aiResult now holds the full result, so the cache is no longer needed.
export function applyGradeResult(prisma: PrismaClient, id: number, data: GradeResult) {
  return prisma.submission.updateMany({ where: { id, status: 'PROCESSING' }, data: { ...data, gradedAt: new Date(), perceptionJson: null } })
}

export interface ShadowResult {
  needsReview: boolean
  aiScore: number
  finalScore: number
  confidence: number
  feedback: string
  // Real usage/cost of this shadow grade (null when the provider didn't report usage).
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  costMicroUsd: number | null // integer µUSD — the bill-grade cost column (usage aggregates on this)
}

export function applyShadowResult(prisma: PrismaClient, id: number, data: ShadowResult) {
  return prisma.submission.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'GRADED', ...data, gradedAt: new Date() } })
}

export function setShadowTakeScore(prisma: PrismaClient, takeId: number, data: { aiScore: number; spokenText: string }) {
  return prisma.shadowTake.update({ where: { id: takeId }, data })
}

// ── student-facing reads/writes (a student only ever touches their own rows) ──

// Anything past DRAFT counts as an attempt used — including FAILED (a genuine
// grading error after submit still consumed the attempt), else a student would
// get a free extra try whenever AI grading errored.
const ACTIVE_STATUSES: SubmissionStatus[] = ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED', 'FAILED']
// A submission is identified per PHASE now: the unique key is
// (assignmentId, phaseId, studentId, attempt) so the phases of one assignment each
// get their own independent attempts/grades.
const byAttempt = (assignmentId: number, phaseId: number, studentId: number, attempt: number) =>
  ({ assignmentId_phaseId_studentId_attempt: { assignmentId, phaseId, studentId, attempt } })
export type MediaKeyField = { videoKey?: string; audioKey?: string; imageKey?: string }

// Attempts already used for this phase (anything past DRAFT) — drives the per-phase
// maxAttempts gate.
export function countActiveAttempts(prisma: PrismaClient, phaseId: number, studentId: number) {
  return prisma.submission.count({ where: { phaseId, studentId, status: { in: ACTIVE_STATUSES } } })
}

// Upsert the draft for an attempt, stamping a media key (re-recording overwrites it).
// offeringId (= the assignment's offering) is denormalized onto the row at create so
// per-offering reads can use the index; it never changes, so update leaves it be.
export function upsertDraftWithMedia(prisma: PrismaClient, assignmentId: number, offeringId: number, phaseId: number, studentId: number, attempt: number, keyField: MediaKeyField) {
  return prisma.submission.upsert({
    where: byAttempt(assignmentId, phaseId, studentId, attempt),
    update: { ...keyField, status: 'DRAFT' },
    create: { assignmentId, offeringId, phaseId, studentId, attempt, ...keyField, status: 'DRAFT' },
  })
}

// Ensure a draft row exists for the attempt (no media yet — used by shadowing).
export function upsertDraft(prisma: PrismaClient, assignmentId: number, offeringId: number, phaseId: number, studentId: number, attempt: number) {
  return prisma.submission.upsert({
    where: byAttempt(assignmentId, phaseId, studentId, attempt),
    update: { status: 'DRAFT' },
    create: { assignmentId, offeringId, phaseId, studentId, attempt, status: 'DRAFT' },
  })
}

export function findOwn(prisma: PrismaClient, id: number, studentId: number) {
  return prisma.submission.findFirst({ where: { id, studentId } })
}

export function findOwnAttempt(prisma: PrismaClient, phaseId: number, studentId: number, attempt: number) {
  return prisma.submission.findFirst({ where: { phaseId, studentId, attempt } })
}

export function findOwnAttemptWithTakeCount(prisma: PrismaClient, phaseId: number, studentId: number, attempt: number) {
  return prisma.submission.findFirst({
    where: { phaseId, studentId, attempt },
    include: { _count: { select: { shadowTakes: true } } },
  })
}

export function updateMediaMeta(prisma: PrismaClient, id: number, data: { sizeBytes: number | null; durationSec: number | null; violations?: string | null }) {
  return prisma.submission.update({ where: { id }, data })
}

// Idempotent submit: only the call that moves DRAFT→submitted matches, so
// concurrent/duplicate finishes can't double-grade or reset a finalized row.
// needsReview defaults true (media/text → AI or teacher looks); a 单选投票 passes
// false so a no-score poll vote never clogs the teacher's 待批 queue.
export function flipDraft(prisma: PrismaClient, id: number, status: SubmissionStatus, needsReview = true) {
  return prisma.submission.updateMany({ where: { id, status: 'DRAFT' }, data: { status, needsReview } })
}

// 单选题（设了正确答案）客观判分：DRAFT→GRADED，写 finalScore、无需复核。
// Fenced to DRAFT，与 flipDraft 一样幂等：并发/重复 finish 不会重复判分或覆盖已定稿的行。
export function flipDraftGraded(prisma: PrismaClient, id: number, score: number) {
  return prisma.submission.updateMany({
    where: { id, status: 'DRAFT' },
    data: { status: 'GRADED', finalScore: score, needsReview: false, gradedAt: new Date() },
  })
}

export function upsertShadowTake(prisma: PrismaClient, submissionId: number, order: number, audioKey: string) {
  return prisma.shadowTake.upsert({
    where: { submissionId_order: { submissionId, order } },
    update: { audioKey },
    create: { submissionId, order, audioKey },
  })
}

export function upsertRecitedText(prisma: PrismaClient, assignmentId: number, offeringId: number, phaseId: number, studentId: number, attempt: number, text: string) {
  return prisma.submission.upsert({
    where: byAttempt(assignmentId, phaseId, studentId, attempt),
    update: { recitedText: text, textSubmittedAt: new Date() },
    create: { assignmentId, offeringId, phaseId, studentId, attempt, recitedText: text, textSubmittedAt: new Date(), status: 'DRAFT' },
  })
}
