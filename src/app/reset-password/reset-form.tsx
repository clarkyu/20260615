'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { resetPassword } from '@/actions/auth'
import { AuthShell } from '@/components/auth-shell'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ResetForm({ token }: { token: string }) {
  const [state, action, isPending] = useActionState(resetPassword, null)

  return (
    <AuthShell
      title="Choose a new password"
      footer={
        <Link href="/login" className="font-medium text-foreground hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} placeholder="At least 8 characters" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} placeholder="Re-enter password" />
        </div>

        {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
        {state?.success ? (
          <FormMessage tone="success">Password updated. You can now sign in with your new password.</FormMessage>
        ) : null}

        <Button type="submit" disabled={isPending || !token || Boolean(state?.success)} className="w-full">
          {isPending ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </AuthShell>
  )
}
