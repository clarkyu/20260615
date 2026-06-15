import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AssignmentForm } from '@/components/assignment-form'

export default async function NewAssignmentDirectPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  // All of the teacher's offerings — the assignment can be published to any of them.
  const offerings = await prisma.courseOffering.findMany({
    where: { schoolId: user.schoolId, ...(user.role === 'TEACHER' ? { teacherId: user.userId } : {}) },
    orderBy: [{ year: 'desc' }, { semester: 'desc' }, { id: 'desc' }],
    include: { course: { select: { name: true } }, class: { select: { name: true } } },
  })

  if (offerings.length === 0) {
    return (
      <div className="space-y-4 py-2">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
            {t('asg.noOfferingFirst')}
            <Link href="/dashboard/teaching/new">
              <Button size="sm">{t('teach.new')}</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const targets = offerings.map((o) => ({
    offeringId: o.id,
    label: `${o.course.name} · ${o.class.name} · ${o.year} ${o.semester === '2' ? t('teach.sem2') : t('teach.sem1')}`,
  }))

  return (
    <div className="py-2">
      <AssignmentForm targets={targets} />
    </div>
  )
}
