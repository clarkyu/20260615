'use client'

import { ShieldCheck } from 'lucide-react'
import { useT } from '@/components/i18n-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const KEY = 'hihw:recordConsent:v1'

// Whether the student has acknowledged the camera/mic capture notice. Remembered per
// device so it's a one-time gate, not a nag before every recording.
export function hasRecordConsent(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
function remember() {
  try { localStorage.setItem(KEY, '1') } catch { /* private mode / blocked storage — just don't persist */ }
}

// One-time modal shown before the first capture: what's collected, why, and where it
// goes. Accepting remembers the choice and proceeds; cancelling backs out.
export function RecordConsentNotice({ onAccept, onCancel }: { onAccept: () => void; onCancel: () => void }) {
  const t = useT()
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-4 sm:items-center" role="dialog" aria-modal="true">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-3 p-5 text-sm">
          <p className="flex items-center gap-2 text-base font-semibold text-foreground">
            <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />{t('consent.title')}
          </p>
          <p className="leading-relaxed text-muted-foreground">{t('consent.body')}</p>
          <div className="flex gap-3 pt-1">
            <Button variant="ghost" className="flex-1" onClick={onCancel}>{t('consent.cancel')}</Button>
            <Button className="flex-1" onClick={() => { remember(); onAccept() }}>{t('consent.agree')}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
