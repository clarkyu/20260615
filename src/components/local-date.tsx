'use client'

import { formatLocalDay } from '@/lib/time'
import { useTzOffset } from './tz-provider'

// Renders a UTC instant as a YYYY-MM-DD date in the user's timezone. The offset comes
// from the `tzo` cookie via TzOffsetProvider, so the SERVER and the CLIENT compute the
// exact same day from (iso, offset) — no hydration mismatch, no first-paint UTC→local
// flash. (Previously this read the browser's local timezone only on the client, which
// diverged from the UTC server render and flashed on hydration.)
export function LocalDate({ iso }: { iso: string }) {
  return <span>{formatLocalDay(iso, useTzOffset())}</span>
}
