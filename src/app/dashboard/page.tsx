import Link from 'next/link'
import { cookies } from 'next/headers'
import { Users, GraduationCap, ClipboardCheck, ClipboardPen, ChevronRight, ChevronDown, CheckCircle2, Check, UserCog, Library, Gauge, Coins, Activity } from 'lucide-react'
import { requireStaff, availablePanels } from '@/lib/auth'
import { parseTzOffset, DAY_MS } from '@/lib/time'
import { getDb } from '@/lib/db'
import { runAfterResponse } from '@/lib/cf'
import { drainGradingJobs } from '@/lib/domain/jobs'
import type { Metadata } from 'next'
import { getT } from '@/lib/i18n-server'
import * as userRepo from '@/lib/repo/users'
import * as dashboardRepo from '@/lib/repo/dashboard'
import * as schoolRepo from '@/lib/repo/schools'
import * as submissionRepo from '@/lib/repo/submissions'
import * as classRepo from '@/lib/repo/classes'
import { gradingCalibration, gradingCalibrationByTeacher, CALIBRATION_WINDOW_DAYS } from '@/lib/domain/analytics'
import { groupAssignmentBatches } from '@/lib/assignment-batches'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CreateSchoolForm } from './create-school-form'
import { PlatformHome } from './platform-home'
import { PanelSwitcher } from './panel-switcher'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('nav.dashboard') }
}

export default async function DashboardPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()

  // The user may focus their view down to a lower-role panel; render by panelRole.
  const panels = availablePanels(user.role, user.schoolId)
  const switcher = panels.length > 1 ? <PanelSwitcher panels={panels} active={user.panelRole} /> : null

  // The platform console (super-admin panel) — no school of its own.
  if (user.panelRole === 'SUPER_ADMIN') {
    const schools = await schoolRepo.listAllWithCounts(prisma)
    return (
      <div className="space-y-4 py-2">
        {switcher}
        <PlatformHome name={user.name || user.email || ''} schools={schools} />
      </div>
    )
  }

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
  // Drain on a FRESH client inside the deferred callback — the request-scoped one may
  // not outlive the response (mirrors scheduleGrading's getDb()).
  await runAfterResponse(async () => drainGradingJobs(await getDb()))

  const tzo = parseTzOffset((await cookies()).get('tzo')?.value)
  const { students, classes, assignments, offeringsCount, pendingCount, dueToday, pendingGroups, needRows } =
    await dashboardRepo.loadStaffDashboard(prisma, schoolId, user.userId, user.panelRole, tzo)
  const isAdmin = user.panelRole === 'SCHOOL_ADMIN'
  // School-wide AI grading calibration — admin-only, and only once teachers have
  // re-scored some AI grades (otherwise nothing to calibrate against). One query feeds
  // both the school-wide number and the per-teacher outlier breakdown.
  const calSince = new Date(Date.now() - CALIBRATION_WINDOW_DAYS * DAY_MS)
  const scorePairs = isAdmin ? await submissionRepo.listScorePairsForSchool(prisma, schoolId, calSince) : []
  const calibration = isAdmin ? gradingCalibration(scorePairs) : null
  const byTeacher = gradingCalibrationByTeacher(
    scorePairs.map((p) => ({
      aiScore: p.aiScore,
      teacherScore: p.teacherScore,
      teacherId: p.assignment.offering.teacherId,
      teacherName: p.assignment.offering.teacher?.name ?? '',
    })),
  )
  const countById = new Map(pendingGroups.map((g) => [g.assignmentId, g._count._all]))
  // 待批列表按发布批次归拢(与作业列表页同一分组):批次卡汇总待批数、按待批降序;
  // 展开为班级行(各自待批数,校管附教师名),点班级行进该班评分页。
  const teacherById = new Map(needRows.map((a) => [a.id, a.offering.teacher?.name ?? null]))
  const needBatches = groupAssignmentBatches(
    needRows.map((a) => ({
      id: a.id, title: a.title, category: a.category, mode: a.mode, dueAt: a.dueAt, batchId: a.batchId,
      phaseCount: 0, courseId: a.offering.courseId, courseName: a.offering.course.name, classId: a.offering.classId, className: a.offering.class.name,
    })),
    new Map(),
    countById,
  ).sort((x, y) => y.totalPending - x.totalPending)

  // 班级人数(全站口径:班级名后带人数)。
  const sizeRows = await classRepo.classSizes(prisma, [...new Set(needBatches.flatMap((b) => b.classes.map((c) => c.classId)))])
  const sizeByClassId = new Map(sizeRows.map((r) => [r.classId, r._count._all]))
  const classLabel = (classId: number, name: string) => `${name}${sizeByClassId.has(classId) ? t('class.size', { n: sizeByClassId.get(classId) as number }) : ''}`

  const stats = [
    { label: t('dash.statStudents'), value: students, href: '/dashboard/students' },
    { label: t('dash.statClasses'), value: classes, href: '/dashboard/students' },
    { label: t('dash.statAssignments'), value: assignments, href: '/dashboard/assignments' },
  ]

  return (
    <div className="space-y-5 py-2">
      {switcher}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{me.school.name}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge tone={isAdmin ? 'primary' : 'muted'}>{isAdmin ? t('dash.scopeAdmin') : t('dash.scopeTeacher')}</Badge>
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
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white/15">
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
        {isAdmin ? (
          <Link href="/dashboard/teachers">
            <Card className="tap h-full hover:shadow-card">
              <CardContent className="flex flex-col gap-1.5 p-4">
                <UserCog className="h-5 w-5 text-accent-foreground" />
                <p className="text-sm font-semibold">{t('teacher.title')}</p>
              </CardContent>
            </Card>
          </Link>
        ) : null}
        <Link href="/dashboard/usage">
          <Card className="tap h-full hover:shadow-card">
            <CardContent className="flex flex-col gap-1.5 p-4">
              <Coins className="h-5 w-5 text-accent-foreground" />
              <p className="text-sm font-semibold">{t('usage.title')}</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard/diagnostics">
          <Card className="tap h-full hover:shadow-card">
            <CardContent className="flex flex-col gap-1.5 p-4">
              <Activity className="h-5 w-5 text-accent-foreground" />
              <p className="text-sm font-semibold">{t('diag.title')}</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Needs-grading board */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('dash.needGrading')}</h2>
        {needBatches.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <CheckCircle2 className="h-5 w-5 text-success" />{t('dash.allClear')}
            </CardContent>
          </Card>
        ) : (
          needBatches.map((b) => {
            const badge = b.mode ? t(`mode.${b.mode}`) : b.category
            // 单班批次:直达该班评分页的卡(与旧版单卡等价)。
            if (b.classes.length === 1) {
              const c = b.classes[0]
              const teacher = isAdmin ? teacherById.get(c.assignmentId) : null
              return (
                <Link key={b.key} href={`/dashboard/assignments/${c.assignmentId}`}>
                  <Card className="tap hover:shadow-card">
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        {badge ? <Badge tone="primary" className="mb-1">{badge}</Badge> : null}
                        <p className="truncate font-semibold leading-snug">{b.title}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{b.courseName} · {classLabel(c.classId, c.className)}{teacher ? ` · ${teacher}` : ''}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                        {t('dash.pendingN', { n: c.pending })}
                      </span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                    </CardContent>
                  </Card>
                </Link>
              )
            }
            // 多班批次:汇总待批的可折叠卡,展开为班级行(按待批降序),各行进该班评分页。
            return (
              <details key={b.key} className="group rounded-2xl border border-border bg-card shadow-card">
                <summary className="tap flex cursor-pointer list-none items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    {badge ? <Badge tone="primary" className="mb-1">{badge}</Badge> : null}
                    <p className="truncate font-semibold leading-snug">{b.title}</p>
                    {/* 这里的 n = 有待批的班数(看板按待批分组),不是发布班数——
                        与列表页的 asgList.classesN 同形不同义,各用各的键(复查 R22)。 */}
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{b.courseName} · {t('dash.pendingClassesN', { n: b.classes.length })}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                    {t('dash.pendingN', { n: b.totalPending })}
                  </span>
                  <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="space-y-1 border-t border-border/60 p-2">
                  {/* 班级序号升序(全站口径,2026-07-12 起替代原「待批数降序」);待批数仍在行内醒目显示。 */}
                  {b.classes.map((c) => {
                    const teacher = isAdmin ? teacherById.get(c.assignmentId) : null
                    return (
                      <Link key={c.assignmentId} href={`/dashboard/assignments/${c.assignmentId}`} className="tap flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-accent">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {classLabel(c.classId, c.className)}
                          {teacher ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">{teacher}</span> : null}
                        </span>
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{t('dash.pendingN', { n: c.pending })}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Link>
                    )
                  })}
                </div>
              </details>
            )
          })
        )}
      </div>

      {/* School-wide AI grading calibration (admin) */}
      {calibration ? (
        <div className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <Gauge className="h-4 w-4 text-primary" />{t('dash.calTitle')}
          </h2>
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-2xl font-extrabold tabular-nums">{calibration.sampleSize}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{t('insights.calSample')}</div>
                </div>
                <div>
                  <div className="text-2xl font-extrabold tabular-nums">{calibration.meanDelta > 0 ? '+' : ''}{calibration.meanDelta}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{t('insights.calDelta')}</div>
                </div>
                <div>
                  <div className="text-2xl font-extrabold tabular-nums">{Math.round(calibration.agreeRate * 100)}%</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{t('insights.calAgree')}</div>
                </div>
              </div>
              <div className="flex justify-center">
                <Badge tone={calibration.bias === 'fair' ? 'success' : 'warning'}>
                  {t(calibration.bias === 'harsh' ? 'insights.calHarsh' : calibration.bias === 'lenient' ? 'insights.calLenient' : 'insights.calFair')}
                </Badge>
              </div>
              <p className="text-center text-xs text-muted-foreground">{t('dash.calHint', { days: CALIBRATION_WINDOW_DAYS })}</p>
              {byTeacher.length >= 2 ? (
                <div className="space-y-1.5 border-t border-border/60 pt-3">
                  <div className="text-xs font-medium text-muted-foreground">{t('dash.calByTeacher')}</div>
                  {byTeacher.map((tc) => (
                    <div key={tc.teacherId} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{tc.teacherName || '—'}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{t('dash.calReviewedN', { n: tc.sampleSize })}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{tc.meanDelta > 0 ? '+' : ''}{tc.meanDelta}</span>
                      <Badge tone={tc.bias === 'fair' ? 'success' : 'warning'}>
                        {t(tc.bias === 'harsh' ? 'dash.biasHarshShort' : tc.bias === 'lenient' ? 'dash.biasLenientShort' : 'dash.biasFairShort')}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="tap h-full hover:shadow-card">
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-extrabold tracking-tight">{s.value}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
