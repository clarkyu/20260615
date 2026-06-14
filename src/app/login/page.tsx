import { getSafeRedirectPath } from '@/lib/app-url'
import { LoginForm } from './login-form'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  return <LoginForm next={getSafeRedirectPath(next ?? '/')} />
}
