import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Inbox } from 'lucide-react'
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

  const assignments = await prisma.assignment.findMany({
    where: { offering: { classId: me.classId } },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { sentences: true } },
      offering: { include: { course: { select: { name: true } } } },
      submissions: { where: { studentId: user.userId }, orderBy: { attempt: 'desc' }, take: 1 },
    },
  })

  return (
    <div className="space-y-4 py-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('shome.title')}</h1>
        <p className="text-sm text-muted-foreground">{me.name}（{me.studentNo}）</p>
      </div>

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
