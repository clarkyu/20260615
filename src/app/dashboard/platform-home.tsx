import Link from 'next/link'
import { Library, School, Users, ChevronRight, ListChecks } from 'lucide-react'
import { getT } from '@/lib/i18n-server'
import { Card, CardContent } from '@/components/ui/card'
import { CreatePlatformSchoolForm } from './create-platform-school-form'

type SchoolRow = { id: number; name: string; code: string; _count: { users: number; classes: number } }

// The super-admin's home: a platform console, not the "create your school" funnel.
// A super-admin curates the global item bank and provisions schools, but belongs
// to none.
export async function PlatformHome({ name, schools }: { name: string; schools: SchoolRow[] }) {
  const { t } = await getT()

  return (
    <div className="space-y-5 py-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('plat.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('plat.desc', { name })}</p>
      </div>

      {/* First-run guide — only until the first school exists. */}
      {schools.length === 0 ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="space-y-2.5 p-4">
            <p className="font-semibold">{t('plat.onbdTitle')}</p>
            <ol className="space-y-1.5 text-sm">
              {[t('plat.onbdStep1'), t('plat.onbdStep2'), t('plat.onbdStep3')].map((s, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-muted-foreground">{i + 1}</span>
                  <span className="flex-1 pt-0.5 text-muted-foreground">{s}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      <Link href="/dashboard/bank">
        <Card className="tap bg-primary text-primary-foreground hover:shadow-card">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/15">
              <Library className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t('plat.bank')}</p>
              <p className="truncate text-xs opacity-80">{t('plat.bankDesc')}</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 opacity-80" />
          </CardContent>
        </Card>
      </Link>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <School className="h-4 w-4" />{t('plat.schools')}（{schools.length}）
          </h2>
          <CreatePlatformSchoolForm />
        </div>

        {schools.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{t('plat.noSchools')}</CardContent></Card>
        ) : (
          schools.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold leading-snug">{s.name}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      {t('dash.codeLabel')}
                      <span className="rounded-md bg-accent px-1.5 py-0.5 font-mono font-bold tracking-wider text-accent-foreground">{s.code}</span>
                    </span>
                    <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{t('plat.members', { n: s._count.users })}</span>
                    <span className="inline-flex items-center gap-1"><ListChecks className="h-3.5 w-3.5" />{t('plat.classes', { n: s._count.classes })}</span>
                  </p>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
