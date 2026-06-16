'use client'

import { Sparkles } from 'lucide-react'
import { importStarterBank } from '@/actions/bank'
import { useT } from '@/components/i18n-provider'
import { Button } from '@/components/ui/button'
import { useChunkedImport } from './use-chunked-import'

// One-click import of the curated curriculum starter pack. For a super-admin it
// imports into the platform-global pool (toGlobal); for a teacher, into their own
// school. Bounded + resumable on the server, so the button stays available.
export function ImportStarter({ toGlobal = false }: { toGlobal?: boolean }) {
  const t = useT()
  const { run, pending, msg } = useChunkedImport()

  return (
    <div className="space-y-1.5">
      <Button variant="outline" size="sm" onClick={() => run(importStarterBank)} disabled={pending}>
        <Sparkles className="h-4 w-4" />{pending ? t('bank.importing') : t('bank.importStarter')}
      </Button>
      <p className="text-xs text-muted-foreground">{msg ?? t(toGlobal ? 'bank.starterHintGlobal' : 'bank.starterHint')}</p>
    </div>
  )
}
