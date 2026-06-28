import Link from 'next/link'
import { LogOut } from 'lucide-react'
import { logout } from '@/actions/auth'
import { getT } from '@/lib/i18n-server'
import type { CurrentUser } from '@/lib/auth'
import { LocaleToggle } from './locale-toggle'
import { ThemeToggle } from './theme-toggle'

export async function AppHeader({ user }: { user: CurrentUser | null }) {
  const { t } = await getT()
  return (
    <header className="safe-top sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-base font-bold tracking-tight">
          <span aria-hidden className="grid h-7 w-7 place-items-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft">
            你
          </span>
          {t('appName')}
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LocaleToggle />
          {user ? (
            <form action={logout}>
              <button
                type="submit"
                aria-label={t('signOut')}
                className="tap grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </header>
  )
}
