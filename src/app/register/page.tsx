import { getSafeRedirectPath } from '@/lib/app-url'
import { RegisterForm } from './register-form'

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  return <RegisterForm next={getSafeRedirectPath(next ?? '/')} />
}
