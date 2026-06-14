'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { changePassword } from '@/actions/auth'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ProfileClient() {
  const [pwState, pwAction, pwPending] = useActionState(changePassword, null)

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
    </>
  )
}
