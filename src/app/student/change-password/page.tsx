import { requireRole } from '@/lib/auth'
import { getDb } from '@/lib/db'
import * as userRepo from '@/lib/repo/users'
import { ChangePasswordForm } from '@/components/change-password-form'

// First-login screen: change the initial password and (optionally) capture contact
// details. Prefilled with anything already on file (e.g. an email set at import).
export default async function StudentChangePasswordPage() {
  const user = await requireRole('STUDENT')
  const prisma = await getDb()
  const me = await userRepo.findById(prisma, user.userId)
  return <ChangePasswordForm defaultEmail={me?.email ?? ''} defaultPhone={me?.phone ?? ''} />
}
