'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { MailCheck } from 'lucide-react'
import { verifyEmail } from '@/actions/auth'
import { useT } from '@/components/i18n-provider'
import { AuthShell } from '@/components/auth-shell'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'

export function VerifyForm({ token }: { token: string }) {
  const t = useT()
  const [state, action, isPending] = useActionState(verifyEmail, null)
  const footer = (
    <Link href="/login" className="font-semibold text-primary">
      {t('verify.backSignIn')}
    </Link>
  )

  if (!token) {
    return (
      <AuthShell icon={<MailCheck className="h-7 w-7" />} title={t('verify.title')} footer={footer}>
        <FormMessage>{t('verify.missing')}</FormMessage>
      </AuthShell>
    )
  }

  return (
    <AuthShell icon={<MailCheck className="h-7 w-7" />} title={t('verify.title')} description={t('verify.desc')} footer={footer}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
        <Button type="submit" disabled={isPending} size="lg" className="w-full">
          {isPending ? t('verify.verifying') : t('verify.btn')}
        </Button>
      </form>
    </AuthShell>
  )
}
