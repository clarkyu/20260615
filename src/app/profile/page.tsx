import Link from 'next/link'
import { Bot, ChevronRight, MessageSquarePlus, Trophy } from 'lucide-react'
import { requireAuth } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as userRepo from '@/lib/repo/users'
import * as departmentRepo from '@/lib/repo/departments'
import { computePoints } from '@/lib/domain/points'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ProfileClient } from './profile-client'
import { StaffSettings } from './staff-settings'
import { ContactSettings } from './contact-settings'

export default async function ProfilePage() {
  const session = await requireAuth()
  const prisma = await getDb()
  const { t, locale } = await getT()
  const user = await userRepo.findProfile(prisma, session.userId)
  if (!user) {
    const { logout } = await import('@/actions/auth')
    await logout()
    return null
  }

  const isStaff = user.role !== 'STUDENT'
  // A student can be in several classes (all equal) — show them all; derive 专业/院系
  // from the first class that has a major.
  const stuClasses = user.classMemberships.map((m) => m.class)
  const stuMajor = stuClasses.find((c) => c.major)?.major
  const [departments, points] = await Promise.all([
    isStaff && user.schoolId ? departmentRepo.listForSchool(prisma, user.schoolId) : Promise.resolve([]),
    computePoints(prisma, session.userId),
  ])

  const rows = [
    user.email ? { k: t('email'), v: user.email } : null,
    user.studentNo ? { k: locale === 'zh' ? '学号' : 'Student ID', v: user.studentNo } : null,
    user.staffNo ? { k: t('login.staffNo'), v: user.staffNo } : null,
    { k: t('name'), v: user.name || '—' },
    user.phone ? { k: t('prof.phone'), v: user.phone } : null,
    user.school ? { k: locale === 'zh' ? '学校' : 'School', v: user.school.name } : null,
    user.department ? { k: t('prof.department'), v: user.department.name } : null,
    stuClasses.length ? { k: locale === 'zh' ? '班级' : 'Class', v: stuClasses.map((c) => c.name).join(locale === 'zh' ? '、' : ', ') } : null,
    stuMajor ? { k: locale === 'zh' ? '专业' : 'Major', v: stuMajor.name } : null,
    stuMajor ? { k: t('prof.department'), v: stuMajor.department.name } : null,
  ].filter(Boolean) as { k: string; v: string }[]

  return (
    <div className="space-y-4 py-2">
      <h1 className="text-2xl font-bold tracking-tight">{t('prof.account')}</h1>

      {/* 我的积分：派生展示（提建议 / 完成作业 / 高分 / 进步 / 打卡） */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Trophy className="h-4 w-4 text-primary" />{t('pts.title')}
            </span>
            <span className="text-2xl font-extrabold tabular-nums text-primary">
              {points.total}
              <span className="ml-1 text-xs font-medium text-muted-foreground">{t('pts.unit')}</span>
            </span>
          </div>
          {points.streak > 0 ? (
            <p className="text-xs font-semibold text-[hsl(var(--warning))]">{t('pts.streak', { n: points.streak })}</p>
          ) : null}
          {points.rows.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {points.rows.map((r) => (
                <Badge key={r.source} tone="muted">
                  {t('pts.' + r.source)} ×{r.count} · +{r.points}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('pts.empty')}</p>
          )}
          <p className="text-[11px] text-muted-foreground">{t('pts.hint')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="divide-y divide-border/60 p-0">
          {rows.map((r) => (
            <div key={r.k} className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm">
              <span className="text-muted-foreground">{r.k}</span>
              <span className="font-medium">{r.v}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <ContactSettings email={user.email ?? ''} phone={user.phone ?? ''} />
      {isStaff ? (
        <StaffSettings
          staffNo={user.staffNo ?? ''}
          departmentId={user.departmentId}
          departments={departments}
          schoolName={user.school?.name ?? ''}
          hasSchool={Boolean(user.school)}
        />
      ) : null}
      {isStaff ? (
        <Link href="/profile/ai">
          <Card className="tap hover:shadow-card">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
                <Bot className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-snug">{locale === 'zh' ? 'AI 模型目录' : 'AI Models'}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {locale === 'zh' ? '各家各模型的使用范围与价格（密钥自配即将上线）' : 'Scope & pricing of every model'}
                </p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      ) : null}
      <Link href="/feedback">
        <Card className="tap hover:shadow-card">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
              <MessageSquarePlus className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-snug">{t('fb.title')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('fb.rule')}</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>
      <ProfileClient />
    </div>
  )
}
