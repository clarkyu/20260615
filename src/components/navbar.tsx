import Link from 'next/link'
import { logout } from '@/actions/auth'
import { getCurrentUser } from '@/lib/auth'
import { Button } from '@/components/ui/button'

const APP_NAME = process.env.APP_NAME || 'App'

export async function Navbar() {
  const user = await getCurrentUser()

  return (
    <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-bold tracking-tight">
          {APP_NAME}
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          {user ? (
            <>
              <Link
                href="/profile"
                className="hidden text-sm text-muted-foreground hover:text-foreground sm:block"
              >
                {user.name || user.email}
              </Link>
              <form action={logout}>
                <Button type="submit" variant="outline" size="sm">
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="outline" size="sm">
                  Sign in
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm">Register</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
