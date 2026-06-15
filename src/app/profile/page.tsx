import { requireAuth } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { Card, CardContent } from '@/components/ui/card'
import { ProfileClient } from './profile-client'
import { StaffSettings } from './staff-settings'

export default async function ProfilePage() {
  const session = await requireAuth()
  const prisma = await getDb()
  const { t, locale } = await getT()
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { school: true, class: true },
  })
  if (!user) {
    const { logout } = await import('@/actions/auth')
    await logout()
    return null
  }

  const isStaff = user.role !== 'STUDENT'
  const rows = [
    user.email ? { k: t('email'), v: user.email } : null,
    user.studentNo ? { k: locale === 'zh' ? '学号' : 'Student ID', v: user.studentNo } : null,
    user.staffNo ? { k: t('login.staffNo'), v: user.staffNo } : null,
    { k: t('name'), v: user.name || '—' },
    user.school ? { k: locale === 'zh' ? '学校' : 'School', v: user.school.name } : null,
    user.class ? { k: locale === 'zh' ? '班级' : 'Class', v: user.class.name } : null,
  ].filter(Boolean) as { k: string; v: string }[]

  return (
    <div className="space-y-4 py-2">
      <h1 className="text-2xl font-bold tracking-tight">{t('prof.account')}</h1>
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
      {isStaff ? (
        <StaffSettings staffNo={user.staffNo ?? ''} schoolName={user.school?.name ?? ''} hasSchool={Boolean(user.school)} />
      ) : null}
      <ProfileClient />
    </div>
  )
}
