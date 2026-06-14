'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { login, resendVerification } from '@/actions/auth'
import { AuthShell } from '@/components/auth-shell'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('')
  const [state, action, isPending] = useActionState(login, null)
  const [resendState, resendAction, resendPending] = useActionState(resendVerification, null)

  return (
    <AuthShell
      title="Sign in"
      description="Welcome back. Sign in with your email and password."
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-medium text-foreground hover:underline">
            Register
          </Link>
        </>
      }
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="redirectTo" value={next} />
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
          <Input id="password" name="password" type="password" autoComplete="current-password" required placeholder="Your password" />
        </div>

        {state?.error ? <FormMessage>{state.error}</FormMessage> : null}

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      {state?.needsVerification ? (
        <form action={resendAction} className="space-y-2 border-t pt-4">
          <input type="hidden" name="email" value={email} />
          <p className="text-sm text-muted-foreground">
            Your email isn&apos;t verified yet. We can send the verification link again.
          </p>
          {resendState?.success ? (
            <FormMessage tone="success">If that account exists, a new verification link is on its way.</FormMessage>
          ) : null}
          <Button type="submit" variant="outline" disabled={resendPending} className="w-full">
            {resendPending ? 'Sending…' : 'Resend verification email'}
          </Button>
        </form>
      ) : null}

      <p className="text-center text-sm">
        <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground hover:underline">
          Forgot your password?
        </Link>
      </p>
    </AuthShell>
  )
}
