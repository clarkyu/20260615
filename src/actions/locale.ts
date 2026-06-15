'use server'

import { cookies } from 'next/headers'
import { LOCALE_COOKIE, isLocale } from '@/lib/i18n'

export async function setLocale(locale: string) {
  if (!isLocale(locale)) return
  ;(await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
}
