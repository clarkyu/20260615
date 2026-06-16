import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ImportClient } from './import-client'
import { ClassList } from './class-list'
import { NewClassForm } from './new-class-form'

export default async function StudentsPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  const me = await prisma.user.findUnique({ where: { id: user.userId }, include: { school: true } })
  if (!me?.school) redirect('/dashboard')

  const classes = await prisma.classGroup.findMany({
    where: { schoolId: me.school.id },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { members: true } },
      major: { include: { department: { select: { name: true } } } },
    },
  })

  return (
    <div className="space-y-4 py-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('stu.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('stu.loginHint', { code: me.school.code })}</p>
      </div>

      <ImportClient />

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{t('stu.classes')}（{classes.length}）</CardTitle>
          <NewClassForm />
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
                count: c._count.members,
              }))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
