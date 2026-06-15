import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ImportClient } from './import-client'

export default async function StudentsPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  const me = await prisma.user.findUnique({ where: { id: user.userId }, include: { school: true } })
  if (!me?.school) redirect('/dashboard')

  const classes = await prisma.classGroup.findMany({
    where: { schoolId: me.school.id },
    orderBy: { name: 'asc' },
    include: { _count: { select: { members: true } } },
  })

  return (
    <div className="space-y-4 py-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('stu.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('stu.loginHint', { code: me.school.code })}</p>
      </div>

      <ImportClient />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('stu.classes')}（{classes.length}）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0 text-sm">
          {classes.length === 0 ? (
            <p className="text-muted-foreground">{t('stu.noClasses')}</p>
          ) : (
            classes.map((c) => (
              <div key={c.id} className="flex justify-between border-b border-border/60 py-2 last:border-0">
                <span className="font-medium">{c.name}{c.major ? ` · ${c.major}` : ''}</span>
                <span className="text-muted-foreground">{c._count.members} {t('stu.people')}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
