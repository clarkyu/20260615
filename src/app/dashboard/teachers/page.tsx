import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as userRepo from '@/lib/repo/users'
import { Card, CardContent } from '@/components/ui/card'
import { AddTeacherForm } from './add-teacher-form'

export default async function TeachersPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const teachers = await userRepo.listStaffForSchool(prisma, user.schoolId)

  return (
    <div className="space-y-4 py-2">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{t('back')}
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('teacher.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('teacher.desc')}</p>
      </div>

      <AddTeacherForm />

      <Card>
        <CardContent className="divide-y divide-border/60 p-0">
          {teachers.map((tch) => (
            <div key={tch.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="font-medium">
                  {tch.name ?? '—'}
                  {tch.id === user.userId ? <span className="ml-1 text-xs text-primary">（{t('teacher.me')}）</span> : null}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {t('teacher.staffNo')} {tch.staffNo ?? '—'}{tch.email ? ` · ${tch.email}` : ''}
                </div>
              </div>
              <div className="shrink-0 text-xs text-muted-foreground tabular-nums">{tch._count.taughtOfferings} {t('teacher.offerings')}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
