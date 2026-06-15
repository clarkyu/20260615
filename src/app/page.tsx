import Link from 'next/link'
import { redirect } from 'next/navigation'
import { GraduationCap, BookOpenCheck, ChevronRight } from 'lucide-react'
import { getCurrentUser, homePathForRole } from '@/lib/auth'
import { getT } from '@/lib/i18n-server'
import { Card, CardContent } from '@/components/ui/card'

export default async function HomePage() {
  const user = await getCurrentUser()
  if (user) redirect(homePathForRole(user.role))
  const { t } = await getT()
  const APP_NAME = process.env.APP_NAME || '英语背诵作业'

  const roles = [
    {
      href: '/student-login',
      title: t('landing.studentTitle'),
      desc: t('landing.studentDesc'),
      cta: t('landing.studentCta'),
      icon: GraduationCap,
      accent: 'bg-primary text-primary-foreground',
    },
    {
      href: '/login',
      title: t('landing.teacherTitle'),
      desc: t('landing.teacherDesc'),
      cta: t('landing.teacherCta'),
      icon: BookOpenCheck,
      accent: 'bg-accent text-accent-foreground',
    },
  ]

  return (
    <div className="space-y-6 py-6">
      <div className="space-y-3 pt-6 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-primary text-2xl font-bold text-primary-foreground shadow-card">
          背
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">{APP_NAME}</h1>
        <p className="text-sm text-muted-foreground">{t('landing.tagline')}</p>
      </div>

      <div className="space-y-3">
        {roles.map((r) => {
          const Icon = r.icon
          return (
            <Link key={r.href} href={r.href}>
              <Card className="tap transition-shadow hover:shadow-card">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${r.accent}`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{r.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.desc}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
