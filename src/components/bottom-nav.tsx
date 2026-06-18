'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, GraduationCap, BookOpenCheck, User, Library, ClipboardList } from 'lucide-react'
import type { Role } from '@prisma/client'
import { useT } from './i18n-provider'

export function BottomNav({ role, newScores = false }: { role: Role; newScores?: boolean }) {
  const t = useT()
  const path = usePathname()
  const staff = role !== 'STUDENT'

  const items = staff
    ? [
        { href: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, dot: false },
        { href: '/dashboard/assignments', label: t('nav.assignments'), icon: ClipboardList, dot: false },
        { href: '/dashboard/teaching', label: t('nav.teaching'), icon: GraduationCap, dot: false },
        { href: '/dashboard/students', label: t('nav.students'), icon: Users, dot: false },
        { href: '/dashboard/bank', label: t('nav.bank'), icon: Library, dot: false },
        { href: '/profile', label: t('nav.profile'), icon: User, dot: false },
      ]
    : [
        { href: '/student', label: t('nav.myWork'), icon: BookOpenCheck, dot: newScores },
        { href: '/profile', label: t('nav.profile'), icon: User, dot: false },
      ]

  const isActive = (href: string) =>
    href === '/dashboard' ? path === '/dashboard' : path === href || path.startsWith(href + '/')

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto grid max-w-xl" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it) => {
          const active = isActive(it.href)
          const Icon = it.icon
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? 'page' : undefined}
              className={
                'flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ' +
                (active ? 'text-primary' : 'text-muted-foreground')
              }
            >
              <span className="relative">
                <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 1.9} />
                {it.dot ? <span className="absolute -right-1.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-background" /> : null}
              </span>
              {it.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
