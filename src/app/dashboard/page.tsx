import Link from 'next/link'
import { Users, ClipboardList, ChevronRight } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { Card, CardContent } from '@/components/ui/card'
import { CreateSchoolForm } from './create-school-form'

export default async function DashboardPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  const me = await prisma.user.findUnique({ where: { id: user.userId }, include: { school: true } })

  if (!me?.school) {
    return (
      <div className="space-y-5 py-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t('dash.welcome')}, {me?.name || me?.email}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('dash.createSchoolDesc')}</p>
        </div>
        <CreateSchoolForm />
      </div>
    )
  }

  const [students, classes, assignments] = await Promise.all([
    prisma.user.count({ where: { schoolId: me.school.id, role: 'STUDENT' } }),
    prisma.classGroup.count({ where: { schoolId: me.school.id } }),
    prisma.assignment.count({ where: { schoolId: me.school.id } }),
  ])

  const stats = [
    { label: t('dash.statStudents'), value: students },
    { label: t('dash.statClasses'), value: classes },
    { label: t('dash.statAssignments'), value: assignments },
  ]
  const actions = [
    { href: '/dashboard/students', icon: Users, title: t('dash.rosterTitle'), desc: t('dash.rosterDesc') },
    { href: '/dashboard/assignments', icon: ClipboardList, title: t('dash.assignTitle'), desc: t('dash.assignDesc') },
  ]

  return (
    <div className="space-y-5 py-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{me.school.name}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{t('dash.codeLabel')}</span>
          <span className="rounded-lg bg-accent px-2 py-0.5 font-mono text-sm font-bold tracking-wider text-accent-foreground">
            {me.school.code}
          </span>
          <span>· {t('dash.codeForStudents')}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-extrabold tracking-tight">{s.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        {actions.map((a) => {
          const Icon = a.icon
          return (
            <Link key={a.href} href={a.href}>
              <Card className="tap hover:shadow-card">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{a.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{a.desc}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
