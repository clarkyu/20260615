import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import * as userRepo from '@/lib/repo/users'
import { ConfirmProvider } from '@/components/ui/confirm'

// Force a first-login staff member (their initial password was set by an admin)
// through the change-password screen before they can use any dashboard page. The
// screen itself lives at /change-password — outside this layout — so redirecting
// there does not loop. Mirrors the per-page gate students get on their home.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff()
  const prisma = await getDb()
  const me = await userRepo.findById(prisma, user.userId)
  if (me?.mustChangePassword) redirect('/change-password')
  return <ConfirmProvider>{children}</ConfirmProvider>
}
