import { getSafeRedirectPath } from '@/lib/app-url'
import { getDb } from '@/lib/db'
import * as schoolRepo from '@/lib/repo/schools'
import { LoginForm } from './login-form'

export const dynamic = 'force-dynamic'

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
