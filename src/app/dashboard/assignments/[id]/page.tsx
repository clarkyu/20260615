import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft, Eye } from 'lucide-react'
import { requireStaff, getCurrentUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { modelsForCapability } from '@/lib/ai/registry'
import { countViolations } from '@/lib/domain/grading'
import { parseChoices, sameChoiceSet } from '@/lib/choices'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as userRepo from '@/lib/repo/users'
import { GradingClient } from './grading-client'

// Tab title = the assignment's own title (teachers often have several grading tabs
// open). Scoped exactly like the page (own offering for a TEACHER) so a guessed id
// can't leak another teacher's title; falls back to the generic menu name otherwise.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { t } = await getT()
  const fallback = { title: t('nav.assignments') }
  const id = Number((await params).id)
  if (!Number.isInteger(id)) return fallback
  const user = await getCurrentUser()
  if (!user?.schoolId) return fallback
  const prisma = await getDb()
  const a = await assignmentRepo.findForSchool(prisma, id, user.schoolId, user.userId, user.role)
  return a ? { title: a.title } : fallback
}

export default async function AssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assignmentId = Number(id)
  if (!Number.isInteger(assignmentId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const assignment = await assignmentRepo.findDetailForStaff(prisma, assignmentId, user.schoolId, user.userId, user.role)
  if (!assignment) notFound()

  // A submission is per-phase: keep the latest attempt per (student, phase). When the
  // assignment has several phases, label each row with its phase.
  const multiPhase = assignment.phases.length > 1
  const latestByStudentPhase = new Map<string, (typeof assignment.submissions)[number]>()
  for (const s of assignment.submissions) {
    const key = `${s.studentId}:${s.phaseId ?? 0}`
    if (!latestByStudentPhase.has(key)) latestByStudentPhase.set(key, s)
  }

  // 单选投票环节按「票数分布」整体呈现（见下方 pollResults），不逐个学生进评分列表。
  const pollPhaseIds = new Set(assignment.phases.filter((p) => p.requireChoice).map((p) => p.id))

  const rows = [...latestByStudentPhase.values()]
    .filter((s) => !pollPhaseIds.has(s.phaseId ?? -1))
    .map((s) => ({
      id: s.id,
      studentName: s.student.name ?? '',
      studentNo: s.student.studentNo ?? '',
      className: assignment.offering.class.name,
      phaseId: s.phaseId ?? 0,
      phaseOrder: s.phase?.order ?? 0,
      phaseLabel: multiPhase ? (s.phase?.title?.trim() || t('phase.nth', { n: s.phase?.order ?? 0 })) : undefined,
      status: s.status,
      needsReview: s.needsReview,
      aiScore: s.aiScore,
      finalScore: s.finalScore,
      feedback: s.feedback ?? '',
      hasVideo: Boolean(s.videoKey),
      hasAudio: Boolean(s.audioKey),
      hasImage: Boolean(s.imageKey),
      durationSec: s.durationSec ?? 0,
      recitedText: s.recitedText ?? '',
      violations: countViolations(s.violations),
    }))
    .sort((a, b) => a.studentNo.localeCompare(b.studentNo) || a.phaseOrder - b.phaseOrder)

  // 可 AI 评阅的环节（要有音/视频；纯投票/自由文本/手写不走 AI）+ 各自已保存的批阅配置，
  // 供老师「按环节」配置评分标准/模型并预估用量。
  const phases = assignment.phases
    .filter((p) => !pollPhaseIds.has(p.id) && (p.requireVideo || p.requireAudio))
    .map((p) => ({
      id: p.id,
      label: p.title?.trim() || t('phase.nth', { n: p.order }),
      rubric: p.rubric ?? '',
      perceptionModel: p.defaultPerceptionModel ?? '',
      judgeModel: p.defaultJudgeModel ?? '',
      sentenceCount: p._count.sentences,
    }))

  // 选择环节的票数分布：每个环节统计每个选项被选了多少次（取每个学生该环节的最新一次）。
  // 单选（correctChoice）/ 多选（correctChoices，全对才算对）设了答案的当作有正确答案的题：
  // 标出正确项并算正确率。学生作答：多选是 JSON 数组、单选是选项文本。
  const pollSubs = [...latestByStudentPhase.values()].filter((s) => s.status !== 'DRAFT')
  const pollResults = assignment.phases
    .filter((p) => p.requireChoice)
    .map((p) => {
      const subs = pollSubs.filter((s) => s.phaseId === p.id)
      const isMulti = p.multiChoice
      const correctSet = isMulti ? parseChoices(p.correctChoices) : []
      const correct = isMulti ? null : (p.correctChoice?.trim() || null)
      const hasKey = isMulti ? correctSet.length > 0 : correct != null
      const selectedOf = (s: (typeof subs)[number]) => (isMulti ? parseChoices(s.recitedText) : [(s.recitedText ?? '').trim()].filter(Boolean))
      const correctNorm = new Set(correctSet.map((c) => c.trim()))
      return {
        phaseLabel: multiPhase ? (p.title?.trim() || t('phase.nth', { n: p.order })) : undefined,
        total: subs.length,
        correctChoice: correct,
        correctCount: hasKey
          ? subs.filter((s) => (isMulti ? sameChoiceSet(selectedOf(s), correctSet) : (s.recitedText ?? '').trim() === correct)).length
          : null,
        options: parseChoices(p.choicesJson).map((label) => ({
          label,
          count: subs.filter((s) => selectedOf(s).includes(label)).length,
          correct: isMulti ? correctNorm.has(label.trim()) : correct != null && label.trim() === correct,
        })),
      }
    })

  // Who hasn't handed anything in yet: the class roster minus everyone with a
  // non-DRAFT submission (any phase). Lets the teacher chase up missing students —
  // they never appear in the submissions list because they have no row.
  const roster = await userRepo.listClassRoster(prisma, user.schoolId, assignment.offering.class.id)
  const submittedIds = new Set(assignment.submissions.filter((s) => s.status !== 'DRAFT').map((s) => s.studentId))
  const notSubmitted = roster
    .filter((r) => !submittedIds.has(r.id))
    .map((r) => ({ name: r.name ?? '', studentNo: r.studentNo ?? '' }))

  const sem = assignment.offering.semester === '2' ? t('teach.sem2') : t('teach.sem1')

  // Other classes this assignment was published to in the same batch — the grading
  // screen offers to sync a phase's 评阅配置 to them (发布后改一次标准 → 同步同批次).
  const batchSiblings = await assignmentRepo.findBatchSiblings(prisma, assignment.id, user.schoolId, user.userId, user.role)

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href={`/dashboard/teaching/${assignment.offeringId}`} className="inline-flex min-w-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4 shrink-0" />
          <span className="truncate">{assignment.offering.course.name} · {assignment.offering.class.name} · {assignment.offering.year} {sem}</span>
        </Link>
        <Link href={`/dashboard/assignments/${assignment.id}/preview`} className="tap inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          <Eye className="h-3.5 w-3.5" />{t('preview.view')}
        </Link>
      </div>
      <GradingClient
        assignmentId={assignment.id}
        title={assignment.title}
        category={assignment.category}
        sentenceCount={assignment._count.sentences}
        studentCount={new Set([...latestByStudentPhase.values()].map((s) => s.studentId)).size}
        classes={[{ id: assignment.offering.class.id, name: assignment.offering.class.name }]}
        rows={rows}
        pollResults={pollResults}
        phases={phases}
        batchSiblings={batchSiblings}
        notSubmitted={notSubmitted}
        perceptionModels={modelsForCapability('perception').map((m) => ({ id: m.id, label: m.label }))}
        judgeModels={modelsForCapability('judge').map((m) => ({ id: m.id, label: m.label }))}
        defaultRubric={assignment.rubric ?? ''}
      />
    </div>
  )
}
