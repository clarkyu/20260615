import { redirect } from 'next/navigation'

// Public registration is disabled — accounts are provisioned by an admin.
export default function RegisterPage() {
  redirect('/login')
}
