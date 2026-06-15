import Link from 'next/link'
import { Users, GraduationCap, ClipboardCheck, ClipboardPen, ChevronRight, CheckCircle2 } from 'lucide-react'
import type { SubmissionStatus } from '@prisma/client'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CreateSchoolForm } from './create-school-form'

const PENDING: SubmissionStatus[] = ['UPLOADED', 'FLAGGED']

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

  const schoolId = me.school.id
  // A teacher only sees their own offerings; admins see the whole school.
  const offeringWhere = { schoolId, ...(user.role === 'TEACHER' ? { teacherId: user.userId } : {}) }
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1)

  const [students, classes, assignments, pendingCount, dueToday, pendingGroups] = await Promise.all([
    prisma.user.count({ where: { schoolId, role: 'STUDENT' } }),
    prisma.classGroup.count({ where: { schoolId } }),
    prisma.assignment.count({ where: { offering: offeringWhere } }),
    prisma.submission.count({ where: { status: { in: PENDING }, assignment: { offering: offeringWhere } } }),
    prisma.assignment.count({ where: { offering: offeringWhere, dueAt: { gte: todayStart, lt: todayEnd } } }),
    prisma.submission.groupBy({
      by: ['assignmentId'],
      where: { status: { in: PENDING }, assignment: { offering: offeringWhere } },
      _count: { _all: true },
    }),
  ])

  const ids = pendingGroups.map((g) => g.assignmentId)
  const needRows = ids.length
    ? await prisma.assignment.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true, category: true, offering: { select: { course: { select: { name: true } }, class: { select: { name: true } } } } },
      })
    : []
  const countById = new Map(pendingGroups.map((g) => [g.assignmentId, g._count._all]))
  const needGrading = needRows
    .map((a) => ({ id: a.id, title: a.title, category: a.category, course: a.offering.course.name, cls: a.offering.class.name, pending: countById.get(a.id) ?? 0 }))
    .sort((a, b) => b.pending - a.pending)

  const stats = [
    { label: t('dash.statStudents'), value: students },
    { label: t('dash.statClasses'), value: classes },
    { label: t('dash.statAssignments'), value: assignments },
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
        </div>
      </div>

      {/* To-do banner */}
      {pendingCount > 0 || dueToday > 0 ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-3 p-4 text-sm">
            <ClipboardCheck className="h-5 w-5 shrink-0 text-primary" />
            <p className="font-medium">
              {pendingCount > 0 ? t('dash.pendingBanner', { n: pendingCount }) : null}
              {pendingCount > 0 && dueToday > 0 ? ' · ' : null}
              {dueToday > 0 ? t('dash.dueToday', { n: dueToday }) : null}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Primary action: publish */}
      <Link href="/dashboard/teaching/new-assignment">
        <Card className="tap bg-primary text-primary-foreground hover:shadow-card">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/15">
              <ClipboardPen className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t('dash.publishTitle')}</p>
              <p className="truncate text-xs opacity-80">{t('dash.publishDesc')}</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 opacity-80" />
          </CardContent>
        </Card>
      </Link>

      {/* Secondary actions */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/dashboard/teaching">
          <Card className="tap hover:shadow-card">
            <CardContent className="flex flex-col gap-1.5 p-4">
              <GraduationCap className="h-5 w-5 text-accent-foreground" />
              <p className="text-sm font-semibold">{t('teach.title')}</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard/students">
          <Card className="tap hover:shadow-card">
            <CardContent className="flex flex-col gap-1.5 p-4">
              <Users className="h-5 w-5 text-accent-foreground" />
              <p className="text-sm font-semibold">{t('dash.rosterTitle')}</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Needs-grading board */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('dash.needGrading')}</h2>
        {needGrading.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <CheckCircle2 className="h-5 w-5 text-success" />{t('dash.allClear')}
            </CardContent>
          </Card>
        ) : (
          needGrading.map((a) => (
            <Link key={a.id} href={`/dashboard/assignments/${a.id}`}>
              <Card className="tap hover:shadow-card">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    {a.category ? <Badge tone="primary" className="mb-1">{a.category}</Badge> : null}
                    <p className="truncate font-semibold leading-snug">{a.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{a.course} · {a.cls}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                    {t('dash.pendingN', { n: a.pending })}
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))
        )}
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
    </div>
  )
}
