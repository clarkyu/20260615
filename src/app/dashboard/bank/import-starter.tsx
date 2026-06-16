'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { importStarterBank } from '@/actions/bank'
import { useT } from '@/components/i18n-provider'
import { Button } from '@/components/ui/button'

// One-click import of the curated curriculum starter pack. For a super-admin it
// imports into the platform-global pool (toGlobal); for a teacher, into their own
// school. Idempotent on the server, so the button stays available after a run.
export function ImportStarter({ toGlobal = false }: { toGlobal?: boolean }) {
  const t = useT()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  function run() {
    start(async () => {
      const res = await importStarterBank()
      if (res.error) {
        setMsg(res.error)
        return
      }
      setMsg(t('bank.imported').replace('{n}', String(res.imported)).replace('{s}', String(res.skipped)))
      router.refresh()
    })
  }

  return (
    <div className="space-y-1.5">
      <Button variant="outline" size="sm" onClick={run} disabled={pending}>
        <Sparkles className="h-4 w-4" />{pending ? t('bank.importing') : t('bank.importStarter')}
      </Button>
      <p className="text-xs text-muted-foreground">{msg ?? t(toGlobal ? 'bank.starterHintGlobal' : 'bank.starterHint')}</p>
    </div>
  )
}
