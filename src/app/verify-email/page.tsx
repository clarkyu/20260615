import { VerifyForm } from './verify-form'

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  return <VerifyForm token={token ?? ''} />
}
