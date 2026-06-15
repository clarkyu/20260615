import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus, ChevronRight, GraduationCap } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default async function TeachingPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const offerings = await prisma.courseOffering.findMany({
    where: { schoolId: user.schoolId, ...(user.role === 'TEACHER' ? { teacherId: user.userId } : {}) },
    orderBy: [{ year: 'desc' }, { semester: 'desc' }, { id: 'desc' }],
    include: { course: true, class: { select: { name: true } }, _count: { select: { assignments: true } } },
  })

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t('teach.title')}</h1>
        <Link href="/dashboard/teaching/new">
          <Button size="sm"><Plus className="h-4 w-4" />{t('teach.new')}</Button>
        </Link>
      </div>

      {offerings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <GraduationCap className="h-8 w-8 opacity-50" />
            {t('teach.empty')}
          </CardContent>
        </Card>
      ) : (
        offerings.map((o) => (
          <Link key={o.id} href={`/dashboard/teaching/${o.id}`}>
            <Card className="tap hover:shadow-card">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">
                    {o.course.name} <span className="text-xs font-normal text-muted-foreground">{o.course.code}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {o.class.name} · {o.year} {o.semester === '2' ? t('teach.sem2') : t('teach.sem1')} · {o._count.assignments} {t('teach.assignments')}
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
