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
import * as aiUsage from '@/lib/repo/ai-usage'
import * as classRepo from '@/lib/repo/classes'
import { classifyGradingError, AUTO_REQUEUE_MARKER, type GradingErrorClass } from '@/lib/domain/jobs'
import { sortByClassName } from '@/lib/class-sort'
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

  // 支出小结用 UTC 日/月界,与账本 createdAt(DB CURRENT_TIMESTAMP)同一时钟,也与支出护栏
  // 的日界一致。今日/本月花费按本校 scope(不泄露他校);「已暂停」用全平台今日累计判断——
  // 护栏保护的是共享的 Gemini 账单(一 key 一账单),故是平台级布尔量(不显示他校金额)。
  const now = new Date()
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [queue, progress, spend, platformTodayMicro, deadLetters] = await Promise.all([
    diagnostics.queueHealth(prisma, user.schoolId, user.userId, user.role),
    diagnostics.gradingProgress(prisma, user.schoolId, user.userId, user.role),
    aiUsage.spendSummary(prisma, user.schoolId, todayStart, monthStart),
    aiUsage.spendSinceMicroUsd(prisma, todayStart),
    diagnostics.listDeadLetterErrors(prisma, user.schoolId, user.userId, user.role),
  ])

  // 死信画像(可观测):按错误签名分类聚合——一眼分清「限流墙(等自愈)/内容损坏(等归档)/
  // 其它瞬时(该被自动复活)」,不再逐条翻 lastError。分类与队列自愈同一份 classifyGradingError。
  const dlByClass = {} as Record<GradingErrorClass, number>
  let dlRequeued = 0
  for (const r of deadLetters) {
    const cls = classifyGradingError(r.lastError)
    dlByClass[cls] = (dlByClass[cls] ?? 0) + 1
    if ((r.lastError ?? '').includes(AUTO_REQUEUE_MARKER)) dlRequeued++
  }
  const dlLabels: [GradingErrorClass, string][] = [
    ['rate', t('diag.dlRate')],
    ['permanent', t('diag.dlPermanent')],
    ['not-ready', t('diag.dlNotReady')],
    ['transient', t('diag.dlTransient')],
  ]
  const capUsd = config.gradingDailyCapUsd()
  const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`
  const spendPaused = capUsd > 0 && platformTodayMicro >= capUsd * 1_000_000

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
  // 停摆告警:有待评且最老一份已逾 60 分钟没被认领——cron 班次(GitHub schedule 实际
  // 45-70 分钟一班)都该轮到它了,大概率 CRON_SECRET/Action 出了问题,提示手动泵。
  const stalled = pending > 0 && oldestMin != null && oldestMin >= 60

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
  // 班级人数(全站口径:班级名后带人数)。
  const sizeRows = await classRepo.classSizes(prisma, [...new Set(progress.map((a) => a.classId))])
  const sizeByClassId = new Map(sizeRows.map((r) => [r.classId, r._count._all]))
  const classLabel = (classId: number, name: string) => `${name}${sizeByClassId.has(classId) ? t('class.size', { n: sizeByClassId.get(classId) as number }) : ''}`

  // 批次内班级按班级序号升序(全站口径;到达序是建作业时间倒序,与班号无关)。
  for (const g of groups) g.rows = sortByClassName(g.rows, (a) => a.className)

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
          {stalled ? <p className="text-xs font-medium text-destructive">{t('diag.queueStalled', { n: oldestMin as number })}</p> : null}
          {deadLetters.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{t('diag.dlBreakdown')}</p>
              <div className="flex flex-wrap gap-2">
                {dlLabels.map(([cls, label]) =>
                  (dlByClass[cls] ?? 0) > 0 ? (
                    <Badge key={cls} tone={cls === 'permanent' ? 'danger' : undefined}>{label}: {dlByClass[cls]}</Badge>
                  ) : null,
                )}
                {dlRequeued > 0 ? <Badge>{t('diag.dlRequeued', { n: dlRequeued })}</Badge> : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('diag.spend')}</CardTitle></CardHeader>
        <CardContent className="space-y-2 pt-0 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge tone={spendPaused ? 'danger' : 'primary'}>{t('diag.spendToday', { usd: usd(spend.todayMicro) })}</Badge>
            <Badge>{t('diag.spendMonth', { usd: usd(spend.monthMicro) })}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{t('diag.spendCalls', { n: spend.todayCalls, failed: spend.todayFailed })}</p>
          {capUsd > 0 ? <p className="text-xs text-muted-foreground">{t('diag.spendCap', { usd: usd(capUsd * 1_000_000) })}</p> : null}
          {spendPaused ? <p className="text-xs font-medium text-destructive">{t('diag.spendPaused')}</p> : null}
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
                    <span className="ml-1 text-xs text-muted-foreground">{classLabel(g.rows[0].classId, g.rows[0].className)}</span>
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
                        <span className="min-w-0 flex-1 truncate text-sm">{classLabel(a.classId, a.className)}</span>
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
