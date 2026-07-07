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
          {progress.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('diag.noAssignments')}</p>
          ) : (
            progress.map((a) => (
              <Link key={a.assignmentId} href={`/dashboard/assignments/${a.assignmentId}`} className="tap flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-accent">
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-medium">{a.title}</span>
                  <span className="ml-1 text-xs text-muted-foreground">{a.className}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {t('diag.rowStats', { submitted: a.submitted, ai: a.aiScored, review: a.toReview })}
                  {a.failed > 0 ? <span className="ml-1 font-medium text-destructive">{t('diag.rowFailed', { n: a.failed })}</span> : null}
                  {a.processing > 0 ? <span className="ml-1">{t('diag.rowProcessing', { n: a.processing })}</span> : null}
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
