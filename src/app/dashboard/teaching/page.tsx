import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus, GraduationCap, ClipboardPen } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import type { Metadata } from 'next'
import { getT } from '@/lib/i18n-server'
import * as offeringRepo from '@/lib/repo/offerings'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { TeachingList } from './teaching-list'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('nav.teaching') }
}

export default async function TeachingPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const offerings = await offeringRepo.listForStaffWithCounts(prisma, user.schoolId, user.userId, user.role)

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{t('teach.title')}</h1>
        <div className="flex shrink-0 gap-2">
          <Link href="/dashboard/teaching/new">
            <Button size="sm" variant="outline"><Plus className="h-4 w-4" />{t('teach.new')}</Button>
          </Link>
          <Link href="/dashboard/teaching/new-assignment">
            <Button size="sm"><ClipboardPen className="h-4 w-4" />{t('teach.newAssignment')}</Button>
          </Link>
        </div>
      </div>

      {offerings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <GraduationCap className="h-8 w-8 opacity-50" />
            {t('teach.empty')}
          </CardContent>
        </Card>
      ) : (
        <TeachingList
          offerings={offerings.map((o) => ({
            id: o.id,
            courseName: o.course.name,
            courseCode: o.course.code,
            classId: o.classId,
            className: o.class.name,
            classSize: o.class._count.studentMemberships,
            year: o.year,
            semester: o.semester,
            assignmentCount: o._count.assignments,
          }))}
        />
      )}
    </div>
  )
}
