import type { Metadata } from 'next'
import { getT } from '@/lib/i18n-server'
import { VerifyForm } from './verify-form'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('verify.title') }
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  return <VerifyForm token={token ?? ''} />
}
