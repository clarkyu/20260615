'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen } from 'lucide-react'
import { importEnglishFlow } from '@/actions/bank'
import { useT } from '@/components/i18n-provider'
import { Button } from '@/components/ui/button'

// Super-admin one-click import of the English Flow "2000 chunks" pack into the
// global official pool. Idempotent on the server, so re-clicking resumes a
// partial run (e.g. if it timed out part-way through the 40 sets).
export function ImportEnglishFlow() {
  const t = useT()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  function run() {
    start(async () => {
      const res = await importEnglishFlow()
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
        <BookOpen className="h-4 w-4" />{pending ? t('bank.importing') : t('bank.importFlow')}
      </Button>
      <p className="text-xs text-muted-foreground">{msg ?? t('bank.importFlowHint')}</p>
    </div>
  )
}
