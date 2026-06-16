'use client'

import { BookOpen } from 'lucide-react'
import { importEnglishFlow } from '@/actions/bank'
import { useT } from '@/components/i18n-provider'
import { Button } from '@/components/ui/button'
import { useChunkedImport } from './use-chunked-import'

// Super-admin one-click import of the built-in curated chunk pack into the global
// official pool. Bounded + resumable: each call imports a capped batch and the
// hook re-invokes until done.
export function ImportEnglishFlow() {
  const t = useT()
  const { run, pending, msg } = useChunkedImport()

  return (
    <div className="space-y-1.5">
      <Button variant="outline" size="sm" onClick={() => run(importEnglishFlow)} disabled={pending}>
        <BookOpen className="h-4 w-4" />{pending ? t('bank.importing') : t('bank.importFlow')}
      </Button>
      <p className="text-xs text-muted-foreground">{msg ?? t('bank.importFlowHint')}</p>
    </div>
  )
}
