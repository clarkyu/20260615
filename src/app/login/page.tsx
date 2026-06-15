import { getSafeRedirectPath } from '@/lib/app-url'
import { getDb } from '@/lib/db'
import { LoginForm } from './login-form'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const prisma = await getDb()
  const schools = await prisma.school.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
  return <LoginForm next={getSafeRedirectPath(next ?? '/')} schools={schools} />
}
