import Link from 'next/link'
import { Users, GraduationCap, ClipboardCheck, ClipboardPen, ChevronRight, CheckCircle2, Check, UserCog, Library } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { runAfterResponse } from '@/lib/cf'
import { drainGradingJobs } from '@/lib/domain/jobs'
import { getT } from '@/lib/i18n-server'
import * as userRepo from '@/lib/repo/users'
import * as dashboardRepo from '@/lib/repo/dashboard'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CreateSchoolForm } from './create-school-form'

export default async function DashboardPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  const me = await userRepo.findWithSchool(prisma, user.userId)

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
  // Self-heal: drain due/stuck grading jobs in the background so transient AI
  // failures recover even without new submissions. Cheap when the queue is empty.
  await runAfterResponse(() => drainGradingJobs(prisma))

  const { students, classes, assignments, offeringsCount, pendingCount, dueToday, pendingGroups, needRows } =
    await dashboardRepo.loadStaffDashboard(prisma, schoolId, user.userId, user.role)
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

      {/* First-run guide: 3 steps to the first assignment */}
      {assignments === 0 ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <p className="font-semibold">{t('onbd.title')}</p>
            <div className="mt-3 space-y-2">
              {[
                { done: classes > 0, label: t('onbd.step1'), href: '/dashboard/students' },
                { done: offeringsCount > 0, label: t('onbd.step2'), href: '/dashboard/teaching/new' },
                { done: false, label: t('onbd.step3'), href: '/dashboard/teaching/new-assignment' },
              ].map((s, i) => (
                <Link key={i} href={s.href} className="tap flex items-center gap-3 rounded-xl bg-background/70 p-3 hover:bg-background">
                  <span className={'grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ' + (s.done ? 'bg-success text-white' : 'bg-secondary text-muted-foreground')}>
                    {s.done ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className={'flex-1 text-sm ' + (s.done ? 'text-muted-foreground line-through' : 'font-medium')}>{s.label}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t('onbd.teachersHint')}</p>
          </CardContent>
        </Card>
      ) : null}

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
          <Card className="tap h-full hover:shadow-card">
            <CardContent className="flex flex-col gap-1.5 p-4">
              <GraduationCap className="h-5 w-5 text-accent-foreground" />
              <p className="text-sm font-semibold">{t('teach.title')}</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard/students">
          <Card className="tap h-full hover:shadow-card">
            <CardContent className="flex flex-col gap-1.5 p-4">
              <Users className="h-5 w-5 text-accent-foreground" />
              <p className="text-sm font-semibold">{t('dash.rosterTitle')}</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard/bank">
          <Card className="tap h-full hover:shadow-card">
            <CardContent className="flex flex-col gap-1.5 p-4">
              <Library className="h-5 w-5 text-accent-foreground" />
              <p className="text-sm font-semibold">{t('bank.title')}</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard/teachers">
          <Card className="tap h-full hover:shadow-card">
            <CardContent className="flex flex-col gap-1.5 p-4">
              <UserCog className="h-5 w-5 text-accent-foreground" />
              <p className="text-sm font-semibold">{t('teacher.title')}</p>
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
