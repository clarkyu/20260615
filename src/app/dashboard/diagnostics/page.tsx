import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft, Activity } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { aiProviderPresence, storageConfigured, emailConfigured, config } from '@/lib/config'
import { PROVIDER_LABELS, PROVIDER_KEY_ENV } from '@/lib/ai/registry'
import * as diagnostics from '@/lib/repo/diagnostics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { batchKeyOf } from '@/lib/assignment-batches'

// 批阅诊断(只读,期末考核复盘的产物):系统配置有无 / 评阅队列水位 / 按作业的评阅进度。
// 三个问题各花过我们几小时:key 到底配没配、队列是不是在动、哪个班评到哪了——
// 以后打开这页 10 秒能答。SECURITY:配置只显示「在/不在」;无学生个人信息。
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('diag.title') }
}

export default async function DiagnosticsPage() {
  const user = await requireStaff()
  if (!user.schoolId) redirect('/dashboard')
  const prisma = await getDb()
  const { t } = await getT()

  const [queue, progress] = await Promise.all([
    diagnostics.queueHealth(prisma, user.schoolId, user.userId, user.role),
    diagnostics.gradingProgress(prisma, user.schoolId, user.userId, user.role),
  ])

  // 平台级 key 的有无(env 名 → provider 名靠 registry 反查;BYOK 的老师个人 key 不在此列)。
  const envToProvider = new Map(Object.entries(PROVIDER_KEY_ENV).map(([provider, env]) => [env, provider]))
  const providers = aiProviderPresence().map((p) => ({
    label: PROVIDER_LABELS[envToProvider.get(p.env) as keyof typeof PROVIDER_LABELS] ?? p.env,
    present: p.present,
  }))
  const system: { label: string; present: boolean }[] = [
    { label: t('diag.storage'), present: storageConfigured() },
    { label: t('diag.email'), present: emailConfigured() },
    { label: t('diag.cron'), present: Boolean(config.cronSecret()) },
    ...providers,
  ]

  const pending = queue.counts['PENDING'] ?? 0
  const oldestMin = queue.oldestPendingAt ? Math.max(0, Math.round((Date.now() - queue.oldestPendingAt.getTime()) / 60000)) : null

  // 按批次归拢(与作业列表同构:batchId 精确,legacy 同课程+同标题):批次卡出汇总数,
  // 班级行折叠在下。rows 按 createdAt desc 到达,组序沿用首见序。
  const groups: { key: string; title: string; rows: typeof progress; sum: { submitted: number; aiScored: number; toReview: number; failed: number; processing: number } }[] = []
  const byKey = new Map<string, (typeof groups)[number]>()
  for (const a of progress) {
    const key = batchKeyOf(a)
    let g = byKey.get(key)
    if (!g) {
      g = { key, title: a.title, rows: [], sum: { submitted: 0, aiScored: 0, toReview: 0, failed: 0, processing: 0 } }
      byKey.set(key, g)
      groups.push(g)
    }
    g.rows.push(a)
    g.sum.submitted += a.submitted
    g.sum.aiScored += a.aiScored
    g.sum.toReview += a.toReview
    g.sum.failed += a.failed
    g.sum.processing += a.processing
  }

  const stats = (s: { submitted: number; aiScored: number; toReview: number; failed: number; processing: number }) => (
    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
      {t('diag.rowStats', { submitted: s.submitted, ai: s.aiScored, review: s.toReview })}
      {s.failed > 0 ? <span className="ml-1 font-medium text-destructive">{t('diag.rowFailed', { n: s.failed })}</span> : null}
      {s.processing > 0 ? <span className="ml-1">{t('diag.rowProcessing', { n: s.processing })}</span> : null}
    </span>
  )

  return (
    <div className="space-y-3 py-2">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{t('nav.dashboard')}
      </Link>
      <div className="flex items-center gap-2">
        <Activity className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">{t('diag.title')}</h1>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('diag.system')}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2 pt-0">
          {system.map((s) => (
            <Badge key={s.label} tone={s.present ? 'success' : undefined}>
              {s.label}: {s.present ? t('diag.present') : t('diag.absent')}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('diag.queue')}</CardTitle></CardHeader>
        <CardContent className="space-y-2 pt-0 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge tone={pending > 0 ? 'primary' : undefined}>{t('diag.pending')}: {pending}</Badge>
            <Badge>{t('diag.processing')}: {queue.counts['PROCESSING'] ?? 0}</Badge>
            <Badge tone={(queue.counts['FAILED'] ?? 0) > 0 ? 'danger' : undefined}>{t('diag.failed')}: {queue.counts['FAILED'] ?? 0}</Badge>
            <Badge>{t('diag.done')}: {queue.counts['DONE'] ?? 0}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {oldestMin != null ? t('diag.oldestPending', { n: oldestMin }) : t('diag.queueIdle')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('diag.progress')}</CardTitle></CardHeader>
        <CardContent className="space-y-1 pt-0">
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('diag.noAssignments')}</p>
          ) : (
            groups.map((g) =>
              g.rows.length === 1 ? (
                // 单班批次:直达评分页的一行(与原样一致)。
                <Link key={g.key} href={`/dashboard/assignments/${g.rows[0].assignmentId}`} className="tap flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-accent">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-medium">{g.title}</span>
                    <span className="ml-1 text-xs text-muted-foreground">{g.rows[0].className}</span>
                  </span>
                  {stats(g.rows[0])}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              ) : (
                // 多班批次:汇总行可折叠,班级行挂在下面(与作业列表/看板同构)。
                <details key={g.key} className="group rounded-xl">
                  <summary className="tap flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-2 hover:bg-accent">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <span className="font-medium">{g.title}</span>
                      <span className="ml-1 text-xs text-muted-foreground">{t('asgList.classesN', { n: g.rows.length })}</span>
                    </span>
                    {stats(g.sum)}
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="ml-2 space-y-0.5 border-l border-border/60 pl-2">
                    {g.rows.map((a) => (
                      <Link key={a.assignmentId} href={`/dashboard/assignments/${a.assignmentId}`} className="tap flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent">
                        <span className="min-w-0 flex-1 truncate text-sm">{a.className}</span>
                        {stats(a)}
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Link>
                    ))}
                  </div>
                </details>
              ),
            )
          )}
        </CardContent>
      </Card>
    </div>
  )
}
