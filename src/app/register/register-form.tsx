'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { register, resendVerification } from '@/actions/auth'
import { AuthShell } from '@/components/auth-shell'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function RegisterForm({ next }: { next: string }) {
  const [email, setEmail] = useState('')
  const [state, action, isPending] = useActionState(register, null)
  const [resendState, resendAction, resendPending] = useActionState(resendVerification, null)

  // Success: account created, verification email sent. Swap the form for a
  // "check your inbox" panel with the option to resend.
  if (state?.success) {
    return (
      <AuthShell
        title="Check your inbox"
        description={`We sent a verification link to ${email}. Click it to activate your account.`}
        footer={
          <Link href="/login" className="font-medium text-foreground hover:underline">
            Back to sign in
          </Link>
        }
      >
        <form action={resendAction} className="space-y-3">
          <input type="hidden" name="email" value={email} />
          <p className="text-sm text-muted-foreground">
            Didn&apos;t get the email? Check your spam folder, or resend it.
          </p>
          {resendState?.success ? (
            <FormMessage tone="success">Verification link sent again.</FormMessage>
          ) : null}
          <Button type="submit" variant="outline" disabled={resendPending} className="w-full">
            {resendPending ? 'Sending…' : 'Resend verification email'}
          </Button>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create your account"
      description="Register with your email. We'll send a link to verify it."
      footer={
        <>
          Already have an account?{' '}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-foreground hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="redirectTo" value={next} />
        <div className="space-y-2">
          <Label htmlFor="name">Name (optional)</Label>
          <Input id="name" name="name" type="text" autoComplete="name" maxLength={60} placeholder="Your name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="At least 8 characters"
          />
        </div>

        {state?.error ? <FormMessage>{state.error}</FormMessage> : null}

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  )
}
