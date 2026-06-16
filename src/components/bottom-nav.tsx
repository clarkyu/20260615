'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, GraduationCap, BookOpenCheck, User, Library } from 'lucide-react'
import type { Role } from '@prisma/client'
import { useT } from './i18n-provider'

export function BottomNav({ role }: { role: Role }) {
  const t = useT()
  const path = usePathname()
  const staff = role !== 'STUDENT'

  const items = staff
    ? [
        { href: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
        { href: '/dashboard/teaching', label: t('nav.teaching'), icon: GraduationCap },
        { href: '/dashboard/students', label: t('nav.students'), icon: Users },
        { href: '/dashboard/bank', label: t('nav.bank'), icon: Library },
        { href: '/profile', label: t('nav.profile'), icon: User },
      ]
    : [
        { href: '/student', label: t('nav.myWork'), icon: BookOpenCheck },
        { href: '/profile', label: t('nav.profile'), icon: User },
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
              <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 1.9} />
              {it.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
