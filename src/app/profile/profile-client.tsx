'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { changePassword, deleteAccount } from '@/actions/auth'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ProfileClient() {
  const [pwState, pwAction, pwPending] = useActionState(changePassword, null)
  const [delState, delAction, delPending] = useActionState(deleteAccount, null)

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>You&apos;ll be signed out after changing it.</CardDescription>
        </CardHeader>
        <CardContent>
          {pwState?.success ? (
            <div className="space-y-3">
              <FormMessage tone="success">Password updated.</FormMessage>
              <Link href="/login" className="text-sm font-medium hover:underline">
                Sign in again →
              </Link>
            </div>
          ) : (
            <form action={pwAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current password</Label>
                <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={8} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} />
              </div>
              {pwState?.error ? <FormMessage>{pwState.error}</FormMessage> : null}
              <Button type="submit" disabled={pwPending}>
                {pwPending ? 'Updating…' : 'Update password'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Delete account</CardTitle>
          <CardDescription>This permanently deletes your account. This cannot be undone.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={delAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmation">Type DELETE to confirm</Label>
              <Input id="confirmation" name="confirmation" type="text" autoComplete="off" placeholder="DELETE" required />
            </div>
            {delState?.error ? <FormMessage>{delState.error}</FormMessage> : null}
            <Button type="submit" variant="destructive" disabled={delPending}>
              {delPending ? 'Deleting…' : 'Delete my account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  )
}
