import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft, ChevronRight, Video, ListChecks } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as bankRepo from '@/lib/repo/bank'
import { Card, CardContent } from '@/components/ui/card'
import { CreateSetForm } from './create-set-form'

export default async function BankPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const sets = await bankRepo.listForSchool(prisma, user.schoolId)

  return (
    <div className="space-y-4 py-2">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{t('back')}
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('bank.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('bank.desc')}</p>
      </div>

      <CreateSetForm />

      {sets.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t('bank.empty')}</CardContent></Card>
      ) : (
        sets.map((s) => (
          <Link key={s.id} href={`/dashboard/bank/${s.id}`}>
            <Card className="tap hover:shadow-card">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold leading-snug">{s.name}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><ListChecks className="h-3.5 w-3.5" />{s._count.chunks} {t('bank.chunkUnit')}</span>
                    <span className={'inline-flex items-center gap-1 ' + (s.shadowVideoKey ? 'text-success' : '')}>
                      <Video className="h-3.5 w-3.5" />{s.shadowVideoKey ? t('bank.hasVideo') : t('bank.noVideo')}
                    </span>
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))
      )}
    </div>
  )
}
