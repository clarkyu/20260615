'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Languages } from 'lucide-react'
import { setLocale } from '@/actions/locale'
import { useLocale } from './i18n-provider'

export function LocaleToggle() {
  const locale = useLocale()
  const router = useRouter()
  const [pending, start] = useTransition()
  const next = locale === 'zh' ? 'en' : 'zh'

  return (
    <button
      type="button"
      aria-label="Switch language"
      disabled={pending}
      onClick={() => start(async () => { await setLocale(next); router.refresh() })}
      className="tap inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground disabled:opacity-50"
    >
      <Languages className="h-3.5 w-3.5" />
      {locale === 'zh' ? 'EN' : '中'}
    </button>
  )
}
