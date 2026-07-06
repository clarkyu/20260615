import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import type { Metadata } from 'next'
import { getT } from '@/lib/i18n-server'
import * as userRepo from '@/lib/repo/users'
import * as classRepo from '@/lib/repo/classes'
import * as departmentRepo from '@/lib/repo/departments'
import * as majorRepo from '@/lib/repo/majors'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ImportClient } from './import-client'
import { ClassList } from './class-list'
import { NewClassForm } from './new-class-form'
import { StructureManager } from './structure-manager'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('nav.students') }
}

export default async function StudentsPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  const me = await userRepo.findWithSchool(prisma, user.userId)
  if (!me?.school) redirect('/dashboard')
  const isAdmin = user.role === 'SCHOOL_ADMIN' || user.role === 'SUPER_ADMIN'

  const classes = await classRepo.listWithCountsForSchool(prisma, me.school.id)
  // Admin-only structure cleanup: departments/majors are auto-created by roster import; let an
  // admin remove the empty (mis-imported / orphaned) ones. Only fetched for admins.
  const [departments, majors] = isAdmin
    ? await Promise.all([
        departmentRepo.listWithCountsForSchool(prisma, me.school.id),
        majorRepo.listWithCountsForSchool(prisma, me.school.id),
      ])
    : [[], []]

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
                department: c.major?.department?.name ?? null,
                major: c.major?.name ?? null,
                grade: c.grade,
                count: c._count.studentMemberships,
              }))}
            />
          )}
        </CardContent>
      </Card>

      {isAdmin && (departments.length > 0 || majors.length > 0) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('stu.structure')}</CardTitle>
          </CardHeader>
          <CardContent>
            <StructureManager
              departments={departments.map((d) => ({ id: d.id, name: d.name, majors: d._count.majors, teachers: d._count.teachers }))}
              majors={majors.map((m) => ({ id: m.id, name: m.name, department: m.department?.name ?? null, classes: m._count.classes }))}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
