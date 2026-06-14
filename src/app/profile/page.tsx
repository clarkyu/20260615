import { requireAuth } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ProfileClient } from './profile-client'

export default async function ProfilePage() {
  const session = await requireAuth()
  const prisma = await getDb()
  const user = await prisma.user.findUnique({ where: { id: session.userId! } })
  if (!user) {
    // Session points at a deleted user — treat as signed out.
    const { logout } = await import('@/actions/auth')
    await logout()
    return null
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Your account details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{user.email}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">{user.name || '—'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Email verified</span>
            <span className="font-medium">{user.emailVerified ? 'Yes' : 'No'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Member since</span>
            <span className="font-medium">{user.createdAt.toISOString().slice(0, 10)}</span>
          </div>
        </CardContent>
      </Card>

      <ProfileClient />
    </div>
  )
}
