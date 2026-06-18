import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as userRepo from '@/lib/repo/users'
import * as classRepo from '@/lib/repo/classes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ImportClient } from './import-client'
import { ClassList } from './class-list'
import { NewClassForm } from './new-class-form'

export default async function StudentsPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  const me = await userRepo.findWithSchool(prisma, user.userId)
  if (!me?.school) redirect('/dashboard')
  const isAdmin = user.role === 'SCHOOL_ADMIN' || user.role === 'SUPER_ADMIN'

  const classes = await classRepo.listWithCountsForSchool(prisma, me.school.id)

  return (
    <div className="space-y-4 py-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('stu.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('stu.loginHint', { code: me.school.code })}</p>
      </div>

      {isAdmin ? <ImportClient /> : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{t('stu.classes')}（{classes.length}）</CardTitle>
          {isAdmin ? <NewClassForm /> : null}
        </CardHeader>
        <CardContent>
          {classes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('stu.noClasses')}</p>
          ) : (
            <ClassList
              classes={classes.map((c) => ({
                id: c.id,
                name: c.name,
                department: c.major?.department.name ?? null,
                major: c.major?.name ?? null,
                grade: c.grade,
                count: c._count.studentMemberships,
              }))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
