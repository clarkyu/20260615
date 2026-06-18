import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Inbox, Sparkles } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as userRepo from '@/lib/repo/users'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as practiceRepo from '@/lib/repo/practice'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge, statusTone } from '@/components/ui/badge'

export default async function StudentHome() {
  const user = await requireRole('STUDENT')
  const prisma = await getDb()
  const { locale, t } = await getT()
  const me = await userRepo.findById(prisma, user.userId)
  if (me?.mustChangePassword) redirect('/student/change-password')
  const classIds = await userRepo.studentClassIds(prisma, user.userId)
  if (!me || classIds.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {locale === 'zh' ? '你的账号还未分配班级，请联系老师。' : 'Your account has no class yet — please contact your teacher.'}
      </p>
    )
  }

  const [assignments, practiceRows] = await Promise.all([
    assignmentRepo.listForStudent(prisma, classIds, user.userId),
    practiceRepo.listScoredForStudent(prisma, user.userId),
  ])

  // My growth: 平时成绩 (best practice per assignment), 测试成绩 (graded submissions),
  // completion, and whether my latest graded score beat the previous one.
  const round1 = (n: number) => Math.round(n * 10) / 10
  const mean = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
  const DONE_STATUSES = ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED']
  const bestPractice = new Map<number, number>()
  for (const p of practiceRows) {
    if (p.aiScore == null) continue
    const cur = bestPractice.get(p.assignmentId)
    if (cur == null || p.aiScore > cur) bestPractice.set(p.assignmentId, p.aiScore)
  }

  // An assignment is one or more phases; aggregate over the GRADED phases (or all,
  // when every phase is practice-only). Completed = every counted phase submitted;
  // the exam score is the mean of the GRADED phases' final scores.
  type Asg = (typeof assignments)[number]
  function summarize(a: Asg) {
    const graded = a.phases.filter((p) => p.graded)
    const counted = graded.length > 0 ? graded : a.phases
    const done = counted.filter((p) => { const s = p.submissions[0]; return s && DONE_STATUSES.includes(s.status) }).length
    const scores = counted.map((p) => (p.submissions[0]?.status === 'GRADED' ? p.submissions[0]?.finalScore : null)).filter((v): v is number => v != null)
    return {
      single: a.phases.length === 1,
      p0: a.phases[0],
      doneCount: done,
      totalPhases: counted.length,
      allDone: counted.length > 0 && done === counted.length,
      sentenceCount: a.phases.reduce((n, p) => n + p._count.sentences, 0),
      examScore: scores.length ? mean(scores) : null,
    }
  }
  const summaries = assignments.map((a) => ({ a, ...summarize(a) }))

  const total = assignments.length
  const submittedCount = summaries.filter((s) => s.allDone).length
  const examAvg = mean(summaries.map((s) => s.examScore).filter((v): v is number => v != null))
  const dailyAvg = mean(assignments.map((a) => bestPractice.get(a.id)).filter((v): v is number => v != null))
  const gradedScores = summaries.map((s) => s.examScore).filter((v): v is number => v != null) // createdAt desc
  const improved = gradedScores.length >= 2 && gradedScores[0] > gradedScores[1]
  const tiles = [
    { label: t('shome.daily'), value: dailyAvg == null ? '—' : String(dailyAvg) },
    { label: t('shome.exam'), value: examAvg == null ? '—' : String(examAvg) },
    { label: t('shome.completion'), value: `${submittedCount}/${total}` },
  ]

  return (
    <div className="space-y-4 py-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('shome.title')}</h1>
        <p className="text-sm text-muted-foreground">{me.name}（{me.studentNo}）</p>
      </div>

      {total > 0 ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" />{t('shome.growth')}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {tiles.map((tile) => (
                <div key={tile.label} className="text-center">
                  <div className="text-2xl font-extrabold tracking-tight tabular-nums">{tile.value}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{tile.label}</div>
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-muted-foreground">{t('shome.tilesHint')}</p>
            <p className={improved ? 'animate-pop text-sm font-semibold text-success' : 'text-xs text-muted-foreground'}>{improved ? `🎉 ${t('shome.improved')}` : t('shome.cheerUp')}</p>
          </CardContent>
        </Card>
      ) : null}

      {assignments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Inbox className="h-8 w-8 opacity-50" />
            {t('shome.empty')}
          </CardContent>
        </Card>
      ) : (
        summaries.map(({ a, single, p0, doneCount, totalPhases, allDone, sentenceCount, examScore }) => {
          // Single-phase keeps the original per-submission card; multi-phase shows a
          // 「done/total 环节」progress badge that links into the phase checklist.
          const sub = single ? p0.submissions[0] : null
          const status = sub?.status ?? 'DRAFT'
          const partialText = single ? Boolean(sub?.recitedText) && status === 'DRAFT' : false
          const statusLabel = single
            ? (partialText ? t('shome.partialText') : t('st.' + status))
            : t('shome.phaseProgress', { done: doneCount, total: totalPhases })
          const tone = single ? (partialText ? 'warning' : statusTone(status)) : (allDone ? 'success' : 'muted')
          const notStarted = single ? status === 'DRAFT' && !partialText : doneCount === 0
          const buttonText = single
            ? (status !== 'DRAFT' ? t('shome.viewRedo') : partialText ? t('shome.continueVideo') : t('shome.start'))
            : (notStarted ? t('shome.start') : t('shome.viewRedo'))
          const scoreShown = single ? (status === 'GRADED' ? sub?.finalScore ?? null : null) : (allDone ? examScore : null)
          return (
            <Card key={a.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {a.category ? <Badge tone="primary" className="mb-1">{a.category}</Badge> : null}
                    <p className="font-semibold leading-snug">{a.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {a.offering.course.name} · {sentenceCount} {t('asg.sentences')}
                      {!single ? ` · ${totalPhases} ${t('phase.unit')}` : ''}
                      {a.dueAt ? ` · ${t('asg.due')} ${a.dueAt.toISOString().slice(0, 10)}` : ''}
                    </p>
                  </div>
                  <Badge tone={tone}>{statusLabel}</Badge>
                </div>
                {scoreShown != null ? (
                  <div className="rounded-xl bg-secondary p-3 text-sm">
                    <span className="text-muted-foreground">{t('sub.score')}: </span>
                    <span className="text-lg font-bold">{scoreShown}</span>
                    {single && sub?.feedback ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{sub.feedback}</p> : null}
                  </div>
                ) : null}
                <Link href={`/student/assignments/${a.id}`}>
                  <Button className="w-full" variant={notStarted ? 'default' : 'outline'}>
                    {buttonText}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}
