import type { Metadata } from 'next'
import { getT } from '@/lib/i18n-server'
import { ResetForm } from './reset-form'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('reset.title') }
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  return <ResetForm token={token ?? ''} />
}
