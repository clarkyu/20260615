import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { hashToken } from '@/lib/tokens'
import * as inviteRepo from '@/lib/repo/invites'
import { Card, CardContent } from '@/components/ui/card'
import { JoinForm } from './join-form'

// Public landing for a school invite link. A NEW teacher sets up their account and is
// bound to the inviting school. Invalid/expired/used tokens show a friendly notice.
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  const { t } = await getT()
  const prisma = await getDb()
  const invite = token ? await inviteRepo.findValidByHash(prisma, await hashToken(token), new Date()) : null

  if (!invite || !token) {
    return (
      <div className="mx-auto max-w-sm py-10">
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t('join.invalid')}</CardContent></Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm space-y-4 py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('join.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('join.subtitle', { school: invite.school.name })}</p>
      </div>
      <JoinForm token={token} />
    </div>
  )
}
