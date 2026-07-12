import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, FileDown, GraduationCap, TableProperties, UploadCloud } from 'lucide-react'
import type { Metadata } from 'next'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as offeringRepo from '@/lib/repo/offerings'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as submissionRepo from '@/lib/repo/submissions'
import * as classRepo from '@/lib/repo/classes'
import * as reviewRepo from '@/lib/repo/review'
import * as classPerfRepo from '@/lib/repo/class-perf'
import { buildTeacherArchive, combinePhaseStats, type ClassCell } from '@/lib/domain/archive-view'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LocalDate } from '@/components/local-date'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('review.hubTitle') }
}

// 成绩档案(老师):按「学期 → 任务类别(四态) → 任务 → 环节 → 班级」逐层展示
// (clark 2026-07-11 定;此前按班级平铺)。每学期尾部:课堂表现(雨课堂)块 +
// 期末阶段总结块(各班总评状态收口)。只读聚合,读经 repo/domain,班级叶子链到既有页。
export default async function ReviewHubPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const actor = [user.schoolId, user.userId, user.role] as const
  const [assignments, statRows, offerings, pubByOffering, impByOffering] = await Promise.all([
    assignmentRepo.listForStaffArchive(prisma, ...actor),
    submissionRepo.phaseStatsForStaff(prisma, ...actor),
    offeringRepo.listForStaff(prisma, ...actor),
    reviewRepo.latestLivePublishByOffering(prisma, ...actor),
    classPerfRepo.latestImportByOffering(prisma, ...actor),
  ])
  const classIds = [...new Set(offerings.map((o) => o.classId))]
  const sizes = await classRepo.classSizes(prisma, classIds)
  const sizeByClassId = new Map(sizes.map((s) => [s.classId, s._count._all]))

  const semesters = buildTeacherArchive(assignments, combinePhaseStats(statRows), sizeByClassId)
  // 学期 → 该学期课头(雨课堂块与期末总结块的行);无任务的学期也可能有课头,以课头为准补齐。
  const termOf = (y: string, s: string) => offerings.filter((o) => o.year === y && o.semester === s)
  const termsFromOfferings = [...new Set(offerings.map((o) => `${o.year}|${o.semester}`))]
  const knownTerms = new Set(semesters.map((g) => `${g.year}|${g.semester}`))
  const extraTerms = termsFromOfferings
    .filter((k) => !knownTerms.has(k))
    .sort()
    .reverse()
    .map((k) => {
      const [year, semester] = k.split('|')
      return { year, semester, categories: [] as (typeof semesters)[number]['categories'] }
    })
  const allSemesters = [...semesters, ...extraTerms].sort((a, b) => `${b.year}|${b.semester}`.localeCompare(`${a.year}|${a.semester}`))

  const semLabel = (s: string) => (s === '2' ? t('teach.sem2') : t('teach.sem1'))
  const cellStat = (c: ClassCell) =>
    c.stat == null
      ? '—'
      : `${c.stat.submitted}${c.size != null ? `/${c.size}` : ''} · ${t('arch.graded')} ${c.stat.graded} · ${c.stat.avg == null ? '—' : c.stat.avg.toFixed(1)}`

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{t('review.hubTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('arch.desc')}</p>
      </div>

      {allSemesters.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">{t('review.hubEmpty')}</CardContent>
        </Card>
      )}

      {allSemesters.map((sem) => (
        <Card key={`${sem.year}-${sem.semester}`}>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-lg font-bold">
              {sem.year} {semLabel(sem.semester)}
            </h2>

            {/* 任务类别 → 任务 → 环节 → 班级 */}
            {sem.categories.map((cat) => (
              <details key={cat.mode} className="rounded-xl border border-border/60 px-3 py-2" open={cat.mode === 'EXAM'}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-semibold marker:content-none">
                  {cat.mode === 'OTHER' ? t('arch.uncategorized') : t(`mode.${cat.mode}`)}
                  <Badge tone="muted">{t('arch.taskCount', { n: cat.tasks.length })}</Badge>
                </summary>
                <div className="mt-2 space-y-2">
                  {cat.tasks.map((task) => (
                    <details key={task.key} className="rounded-lg border border-border/50 px-3 py-2">
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm marker:content-none">
                        <span className="font-medium">{task.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {task.dueAt && <LocalDate iso={task.dueAt.toISOString()} />} · {task.classCount} {t('arch.classes')}
                        </span>
                      </summary>
                      <div className="mt-2 space-y-2">
                        {task.phases.map((ph) => (
                          <div key={ph.order} className="rounded-lg bg-secondary/40 px-3 py-2">
                            <p className="text-xs font-medium">
                              {t('arch.phase')} {ph.order}
                              {ph.title ? ` · ${ph.title}` : ''}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                              {ph.classes.map((c) => (
                                <Link
                                  key={c.assignmentId}
                                  href={`/dashboard/assignments/${c.assignmentId}`}
                                  className="text-primary hover:underline"
                                >
                                  {c.className}
                                  <span className="ml-1 text-muted-foreground">{cellStat(c)}</span>
                                </Link>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            ))}

            {/* 课堂表现(雨课堂) */}
            <details className="rounded-xl border border-border/60 px-3 py-2">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-semibold marker:content-none">
                {t('arch.rainBlock')}
              </summary>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {termOf(sem.year, sem.semester).map((o) => {
                  const imp = impByOffering.get(o.id)
                  return (
                    <Link
                      key={o.id}
                      href={`/dashboard/teaching/${o.id}/review/classroom`}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <TableProperties className="h-3.5 w-3.5" />
                      {o.class.name}
                      {imp ? (
                        <span className="text-muted-foreground">
                          <LocalDate iso={imp.toISOString()} />
                        </span>
                      ) : (
                        <Badge tone="warning">{t('review.hubRainNone')}</Badge>
                      )}
                    </Link>
                  )
                })}
              </div>
            </details>

            {/* 期末阶段总结:各班学期总评状态收口 */}
            <details className="rounded-xl border border-border/60 px-3 py-2" open>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-semibold marker:content-none">
                <GraduationCap className="h-4 w-4" />
                {t('arch.finalBlock')}
              </summary>
              <div className="mt-2 space-y-1.5">
                {termOf(sem.year, sem.semester).map((o) => {
                  const pub = pubByOffering.get(o.id)
                  const imp = impByOffering.get(o.id)
                  return (
                    <div key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <Link
                        href={`/dashboard/teaching/${o.id}/review`}
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        {o.class.name}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                      {imp ? <Badge tone="success">{t('review.hubRain')}</Badge> : <Badge tone="warning">{t('review.hubRainNone')}</Badge>}
                      {pub ? (
                        <Badge tone="primary">
                          {t('review.hubPub')} v{pub.version}
                        </Badge>
                      ) : (
                        <Badge tone="muted">{t('review.hubPubNone')}</Badge>
                      )}
                      <Link
                        href={`/dashboard/teaching/${o.id}/review/import`}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <UploadCloud className="h-3.5 w-3.5" />
                        {t('review.importLink')}
                      </Link>
                      <Link
                        href={`/dashboard/teaching/${o.id}/review/export`}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <FileDown className="h-3.5 w-3.5" />
                        {t('rexp.link')}
                      </Link>
                    </div>
                  )
                })}
              </div>
            </details>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
