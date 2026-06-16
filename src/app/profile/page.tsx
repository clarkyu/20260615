import { requireAuth } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as userRepo from '@/lib/repo/users'
import * as departmentRepo from '@/lib/repo/departments'
import { Card, CardContent } from '@/components/ui/card'
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
  const stuMajor = user.class?.major
  const departments = isStaff && user.schoolId ? await departmentRepo.listForSchool(prisma, user.schoolId) : []

  const rows = [
    user.email ? { k: t('email'), v: user.email } : null,
    user.studentNo ? { k: locale === 'zh' ? '学号' : 'Student ID', v: user.studentNo } : null,
    user.staffNo ? { k: t('login.staffNo'), v: user.staffNo } : null,
    { k: t('name'), v: user.name || '—' },
    user.phone ? { k: t('prof.phone'), v: user.phone } : null,
    user.school ? { k: locale === 'zh' ? '学校' : 'School', v: user.school.name } : null,
    user.department ? { k: t('prof.department'), v: user.department.name } : null,
    user.class ? { k: locale === 'zh' ? '班级' : 'Class', v: user.class.name } : null,
    stuMajor ? { k: locale === 'zh' ? '专业' : 'Major', v: stuMajor.name } : null,
    stuMajor ? { k: t('prof.department'), v: stuMajor.department.name } : null,
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
      <ProfileClient />
    </div>
  )
}
