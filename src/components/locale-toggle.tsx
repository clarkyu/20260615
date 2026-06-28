'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Languages } from 'lucide-react'
import { setLocale } from '@/actions/locale'
import { LOCALES } from '@/lib/i18n'
import { useLocale } from './i18n-provider'

// Cycles 中 → EN → ES → 中. The label shows the NEXT language you'll switch to.
const LABEL = { zh: '中', en: 'EN', es: 'ES' } as const

export function LocaleToggle() {
  const locale = useLocale()
  const router = useRouter()
  const [pending, start] = useTransition()
  const next = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length]

  return (
    <button
      type="button"
      aria-label="Switch language"
      disabled={pending}
      onClick={() => start(async () => { await setLocale(next); router.refresh() })}
      className="tap inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-xs font-semibold text-muted-foreground disabled:opacity-50"
    >
      <Languages className="h-3.5 w-3.5" />
      {LABEL[next]}
    </button>
  )
}
