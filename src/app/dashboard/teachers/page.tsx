import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as userRepo from '@/lib/repo/users'
import * as inviteRepo from '@/lib/repo/invites'
import { setStaffRole } from '@/actions/staff'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AddTeacherForm } from './add-teacher-form'
import { InviteTeacher } from './invite-teacher'

export default async function TeachersPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const teachers = await userRepo.listStaffForSchool(prisma, user.schoolId)
  const viewerIsAdmin = user.role === 'SCHOOL_ADMIN' || user.role === 'SUPER_ADMIN'
  const pendingInvites = viewerIsAdmin
    ? (await inviteRepo.listPendingForSchool(prisma, user.schoolId, new Date())).map((i) => ({ id: i.id, expiresAt: i.expiresAt.toISOString() }))
    : []

  return (
    <div className="space-y-4 py-2">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{t('back')}
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('teacher.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('teacher.desc')}</p>
      </div>

      {viewerIsAdmin ? <AddTeacherForm /> : null}
      {viewerIsAdmin ? <InviteTeacher pending={pendingInvites} /> : null}

      <Card>
        <CardContent className="divide-y divide-border/60 p-0">
          {teachers.map((tch) => {
            const isAdmin = tch.role === 'SCHOOL_ADMIN'
            return (
              <div key={tch.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 font-medium">
                    {tch.name ?? '—'}
                    <Badge tone={isAdmin ? 'primary' : 'muted'}>{isAdmin ? t('role.admin') : t('role.teacher')}</Badge>
                    {tch.id === user.userId ? <span className="text-xs text-primary">（{t('teacher.me')}）</span> : null}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {t('teacher.staffNo')} {tch.staffNo ?? '—'}{tch.email ? ` · ${tch.email}` : ''} · {tch._count.taughtOfferings} {t('teacher.offerings')}
                  </div>
                </div>
                {viewerIsAdmin && tch.id !== user.userId ? (
                  <form action={setStaffRole} className="shrink-0">
                    <input type="hidden" name="staffId" value={tch.id} />
                    <input type="hidden" name="role" value={isAdmin ? 'TEACHER' : 'SCHOOL_ADMIN'} />
                    <Button type="submit" size="sm" variant="outline">{isAdmin ? t('teacher.makeTeacher') : t('teacher.makeAdmin')}</Button>
                  </form>
                ) : null}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
