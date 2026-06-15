import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Plus, Pencil, ChevronRight, ChevronLeft, ClipboardList } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default async function OfferingPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId: oid } = await params
  const offeringId = Number(oid)
  if (!Number.isInteger(offeringId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const offering = await prisma.courseOffering.findFirst({
    where: { id: offeringId, schoolId: user.schoolId },
    include: {
      course: true,
      class: { select: { name: true } },
      assignments: {
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { sentences: true, submissions: true } } },
      },
    },
  })
  if (!offering) notFound()
  const sem = offering.semester === '2' ? t('teach.sem2') : t('teach.sem1')

  return (
    <div className="space-y-4 py-2">
      <Link href="/dashboard/teaching" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{t('nav.teaching')}
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{offering.course.name}</h1>
          <p className="text-sm text-muted-foreground">{offering.course.code} · {offering.class.name} · {offering.year} {sem}</p>
        </div>
        <Link href={`/dashboard/teaching/${offering.id}/edit`}>
          <Button variant="outline" size="sm"><Pencil className="h-4 w-4" />{t('teach.manage')}</Button>
        </Link>
      </div>

      <div className="flex items-center justify-between pt-1">
        <h2 className="font-semibold">{t('teach.assignments')}</h2>
        <Link href={`/dashboard/teaching/${offering.id}/new`}>
          <Button size="sm"><Plus className="h-4 w-4" />{t('teach.newAssignment')}</Button>
        </Link>
      </div>

      {offering.assignments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <ClipboardList className="h-8 w-8 opacity-50" />
            {t('teach.noAssignments')}
          </CardContent>
        </Card>
      ) : (
        offering.assignments.map((a) => (
          <Link key={a.id} href={`/dashboard/assignments/${a.id}`}>
            <Card className="tap hover:shadow-card">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  {a.category ? <Badge tone="primary" className="mb-1">{a.category}</Badge> : null}
                  <p className="font-semibold leading-snug">{a.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {a._count.sentences} {t('asg.sentences')} · {a._count.submissions} {t('asg.submissions')}
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
