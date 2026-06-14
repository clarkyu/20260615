'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { verifyEmail } from '@/actions/auth'
import { AuthShell } from '@/components/auth-shell'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'

export function VerifyForm({ token }: { token: string }) {
  // On success the action redirects home, so we only render the button/error
  // states here. The action (not page render) consumes the token, which keeps
  // email-client link prefetchers from spending it.
  const [state, action, isPending] = useActionState(verifyEmail, null)

  if (!token) {
    return (
      <AuthShell
        title="Verify your email"
        description="This link is missing its token."
        footer={
          <Link href="/login" className="font-medium text-foreground hover:underline">
            Back to sign in
          </Link>
        }
      >
        <FormMessage>The verification link is invalid. Please use the most recent email we sent you.</FormMessage>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Verify your email"
      description="Confirm your email address to activate your account."
      footer={
        <Link href="/login" className="font-medium text-foreground hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? 'Verifying…' : 'Verify my email'}
        </Button>
      </form>
    </AuthShell>
  )
}
