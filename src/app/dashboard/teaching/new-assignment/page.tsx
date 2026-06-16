import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as offeringRepo from '@/lib/repo/offerings'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AssignmentForm } from '@/components/assignment-form'

export default async function NewAssignmentDirectPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  // All of the teacher's offerings — the assignment can be published to any of them.
  const offerings = await offeringRepo.listForStaff(prisma, user.schoolId, user.userId, user.role)

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

  // Use the plain class name (same as the Students page); only add the course
  // when the same class appears more than once (same class, different course).
  const nameCounts = new Map<string, number>()
  for (const o of offerings) nameCounts.set(o.class.name, (nameCounts.get(o.class.name) ?? 0) + 1)
  const targets = offerings.map((o) => ({
    offeringId: o.id,
    label: (nameCounts.get(o.class.name) ?? 0) > 1 ? `${o.class.name} · ${o.course.name}` : o.class.name,
  }))

  return (
    <div className="py-2">
      <AssignmentForm targets={targets} />
    </div>
  )
}
