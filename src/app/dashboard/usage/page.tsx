import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft, Coins, Inbox } from 'lucide-react'
import type { Metadata } from 'next'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as usageRepo from '@/lib/repo/usage'
import { summarizeUsage, formatUsd, formatCny } from '@/lib/domain/usage'
import { formatTokens } from '@/lib/ai/cost'
import { Card, CardContent } from '@/components/ui/card'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('usage.title') }
}

export default async function UsagePage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  // Admins see the whole school (with a per-teacher breakdown); a teacher sees only their
  // own offerings' spend.
  const isAdmin = user.panelRole === 'SCHOOL_ADMIN'
  const rows = await usageRepo.listUsageForSchool(prisma, user.schoolId, isAdmin ? null : user.userId)
  const s = summarizeUsage(rows)

  const thisMonth = new Date().toISOString().slice(0, 7)
  const thisMonthUsd = s.byMonth.find((m) => m.month === thisMonth)?.usd ?? 0
  const pct = (part: number) => (s.totalUsd > 0 ? Math.round((part / s.totalUsd) * 100) : 0)
  const maxTeacher = s.byTeacher[0]?.usd ?? 0
  const maxMonth = Math.max(1, ...s.byMonth.map((m) => m.usd))

  const tiles = [
    { label: t('usage.total'), value: formatUsd(s.totalUsd), sub: formatCny(s.totalUsd) },
    { label: t('usage.thisMonth'), value: formatUsd(thisMonthUsd), sub: formatCny(thisMonthUsd) },
    { label: t('usage.tokens'), value: formatTokens(s.totalTokens), sub: `${s.count} ${t('usage.grades')}` },
  ]

  return (
    <div className="space-y-4 py-2">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{t('back')}
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('usage.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{isAdmin ? t('usage.descAdmin') : t('usage.descTeacher')}</p>
      </div>

      {s.count === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Inbox className="h-8 w-8 opacity-50" />
            {t('usage.empty')}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Coins className="h-4 w-4 text-primary" />{t('usage.spendTitle')}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {tiles.map((tile) => (
                  <div key={tile.label} className="text-center">
                    <div className="text-xl font-extrabold tracking-tight tabular-nums sm:text-2xl">{tile.value}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{tile.sub}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{tile.label}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 提交 vs 练习 花费占比 */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="text-sm font-semibold">{t('usage.bySource')}</div>
              {([['usage.submission', s.submissionUsd, 'bg-primary'], ['usage.practice', s.practiceUsd, 'bg-success']] as const).map(([key, usd, bar]) => (
                <div key={key} className="space-y-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">{t(key)}</span>
                    <span className="font-semibold tabular-nums">{formatUsd(usd)} <span className="text-xs font-normal text-muted-foreground">· {pct(usd)}%</span></span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct(usd)}%` }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {isAdmin && s.byTeacher.length > 0 ? (
            <Card>
              <CardContent className="space-y-2.5 p-4">
                <div className="text-sm font-semibold">{t('usage.byTeacher')}</div>
                {s.byTeacher.map((tch) => (
                  <div key={tch.teacherId} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">{tch.name ?? '—'}<span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{tch.count} {t('usage.grades')}</span></span>
                      <span className="shrink-0 font-semibold tabular-nums">{formatUsd(tch.usd)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${maxTeacher > 0 ? Math.round((tch.usd / maxTeacher) * 100) : 0}%` }} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="space-y-2.5 p-4">
              <div className="text-sm font-semibold">{t('usage.byMonth')}</div>
              {[...s.byMonth].reverse().map((m) => (
                <div key={m.month} className="space-y-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium tabular-nums">{m.month}</span>
                    <span className="font-semibold tabular-nums">{formatUsd(m.usd)}</span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-secondary" title={`${t('usage.submission')} ${formatUsd(m.submissionUsd)} · ${t('usage.practice')} ${formatUsd(m.practiceUsd)}`}>
                    <div className="h-full bg-primary" style={{ width: `${Math.round((m.submissionUsd / maxMonth) * 100)}%` }} />
                    <div className="h-full bg-success" style={{ width: `${Math.round((m.practiceUsd / maxMonth) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <p className="px-1 text-xs text-muted-foreground">{t('usage.note')}</p>
        </>
      )}
    </div>
  )
}
