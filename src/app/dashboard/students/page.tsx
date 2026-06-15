import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
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
              <Link
                key={c.id}
                href={`/dashboard/students/${c.id}`}
                className="-mx-2 flex items-center justify-between gap-2 rounded-lg border-b border-border/60 px-2 py-2.5 last:border-0 hover:bg-secondary/60"
              >
                <span className="font-medium">{c.name}{c.major ? ` · ${c.major}` : ''}</span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  {c._count.members} {t('stu.people')}
                  <ChevronRight className="h-4 w-4" />
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
