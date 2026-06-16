import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Inbox, Sparkles } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge, statusTone } from '@/components/ui/badge'

export default async function StudentHome() {
  const user = await requireRole('STUDENT')
  const prisma = await getDb()
  const { locale, t } = await getT()
  const me = await prisma.user.findUnique({ where: { id: user.userId } })
  if (me?.mustChangePassword) redirect('/student/change-password')
  if (!me?.classId) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {locale === 'zh' ? '你的账号还未分配班级，请联系老师。' : 'Your account has no class yet — please contact your teacher.'}
      </p>
    )
  }

  const [assignments, practiceRows] = await Promise.all([
    prisma.assignment.findMany({
      where: { offering: { classId: me.classId } },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { sentences: true } },
        offering: { include: { course: { select: { name: true } } } },
        submissions: { where: { studentId: user.userId }, orderBy: { attempt: 'desc' }, take: 1 },
      },
    }),
    prisma.practiceAttempt.findMany({
      where: { studentId: user.userId, aiScore: { not: null } },
      select: { assignmentId: true, aiScore: true },
    }),
  ])

  // My growth: 平时成绩 (best practice per assignment), 测试成绩 (graded submissions),
  // completion, and whether my latest graded score beat the previous one.
  const round1 = (n: number) => Math.round(n * 10) / 10
  const mean = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
  const bestPractice = new Map<number, number>()
  for (const p of practiceRows) {
    if (p.aiScore == null) continue
    const cur = bestPractice.get(p.assignmentId)
    if (cur == null || p.aiScore > cur) bestPractice.set(p.assignmentId, p.aiScore)
  }
  const total = assignments.length
  const submittedCount = assignments.filter((a) => a.submissions[0] && a.submissions[0].status !== 'DRAFT').length
  const examAvg = mean(assignments.map((a) => a.submissions[0]?.finalScore).filter((v): v is number => v != null))
  const dailyAvg = mean(assignments.map((a) => bestPractice.get(a.id)).filter((v): v is number => v != null))
  const gradedScores = assignments.map((a) => a.submissions[0]?.finalScore).filter((v): v is number => v != null) // createdAt desc
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
            <p className="text-xs text-muted-foreground">{improved ? `🎉 ${t('shome.improved')}` : t('shome.cheerUp')}</p>
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
        assignments.map((a) => {
          const sub = a.submissions[0]
          const status = sub?.status ?? 'DRAFT'
          const partialText = Boolean(sub?.recitedText) && status === 'DRAFT'
          const statusLabel = partialText ? t('shome.partialText') : t('st.' + status)
          const buttonText = status !== 'DRAFT' ? t('shome.viewRedo') : partialText ? t('shome.continueVideo') : t('shome.start')
          return (
            <Card key={a.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {a.category ? <Badge tone="primary" className="mb-1">{a.category}</Badge> : null}
                    <p className="font-semibold leading-snug">{a.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {a.offering.course.name} · {a._count.sentences} {t('asg.sentences')}
                      {a.dueAt ? ` · ${t('asg.due')} ${a.dueAt.toISOString().slice(0, 10)}` : ''}
                    </p>
                  </div>
                  <Badge tone={partialText ? 'warning' : statusTone(status)}>{statusLabel}</Badge>
                </div>
                {status === 'GRADED' && sub?.finalScore != null ? (
                  <div className="rounded-xl bg-secondary p-3 text-sm">
                    <span className="text-muted-foreground">{t('sub.score')}: </span>
                    <span className="text-lg font-bold">{sub.finalScore}</span>
                    {sub.feedback ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{sub.feedback}</p> : null}
                  </div>
                ) : null}
                <Link href={`/student/assignments/${a.id}`}>
                  <Button className="w-full" variant={status === 'DRAFT' ? 'default' : 'outline'}>
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
