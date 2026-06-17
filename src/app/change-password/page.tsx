import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import * as userRepo from '@/lib/repo/users'
import { ChangePasswordForm } from '@/components/change-password-form'

// First-login screen for staff (teachers/admins): change the admin-set initial
// password and (optionally) capture contact details. Lives at the top level —
// outside the /dashboard layout that redirects here — so there's no redirect loop.
export default async function StaffChangePasswordPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const me = await userRepo.findById(prisma, user.userId)
  return <ChangePasswordForm defaultEmail={me?.email ?? ''} defaultPhone={me?.phone ?? ''} />
}
