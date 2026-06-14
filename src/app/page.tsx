import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const APP_NAME = process.env.APP_NAME || 'App'

export default async function HomePage() {
  const user = await getCurrentUser()

  if (user) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>Welcome back{user.name ? `, ${user.name}` : ''}</CardTitle>
          <CardDescription>You are signed in as {user.email}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Link href="/profile">
            <Button>Account settings</Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 py-10 text-center">
      <h1 className="text-3xl font-bold tracking-tight">{APP_NAME}</h1>
      <p className="text-muted-foreground">
        Create an account with your email to get started. We will send a verification link to confirm
        your address.
      </p>
      <div className="flex justify-center gap-3">
        <Link href="/register">
          <Button size="lg">Create account</Button>
        </Link>
        <Link href="/login">
          <Button size="lg" variant="outline">
            Sign in
          </Button>
        </Link>
      </div>
    </div>
  )
}
