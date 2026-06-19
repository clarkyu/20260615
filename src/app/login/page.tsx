import type { Metadata } from 'next'
import { getSafeRedirectPath } from '@/lib/app-url'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as schoolRepo from '@/lib/repo/schools'
import { LoginForm } from './login-form'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('login.title') }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const prisma = await getDb()
  const schools = await schoolRepo.listAll(prisma)
  return <LoginForm next={getSafeRedirectPath(next ?? '/')} schools={schools} />
}
