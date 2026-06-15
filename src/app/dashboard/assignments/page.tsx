import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus, ChevronRight, ClipboardList } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default async function AssignmentsPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  const me = await prisma.user.findUnique({ where: { id: user.userId } })
  if (!me?.schoolId) redirect('/dashboard')

  const assignments = await prisma.assignment.findMany({
    where: { schoolId: me.schoolId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { sentences: true, submissions: true, classes: true } } },
  })

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t('asg.title')}</h1>
        <Link href="/dashboard/assignments/new">
          <Button size="sm"><Plus className="h-4 w-4" />{t('asg.new')}</Button>
        </Link>
      </div>

      {assignments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <ClipboardList className="h-8 w-8 opacity-50" />
            {t('asg.empty')}
          </CardContent>
        </Card>
      ) : (
        assignments.map((a) => (
          <Link key={a.id} href={`/dashboard/assignments/${a.id}`}>
            <Card className="tap hover:shadow-card">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">{a.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {a._count.sentences} {t('asg.sentences')} · {a._count.classes} {t('asg.classes')} · {a._count.submissions} {t('asg.submissions')}
                    {a.dueAt ? ` · ${t('asg.due')} ${a.dueAt.toISOString().slice(0, 10)}` : ''}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))
      )}
    </div>
  )
}
