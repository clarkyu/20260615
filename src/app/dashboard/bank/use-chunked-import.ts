'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/components/i18n-provider'

type ImportResult = { imported?: number; skipped?: number; remaining?: number; error?: string }

// Drives a bounded, resumable import: the action imports a capped batch per call
// and returns `remaining`; we re-invoke (idempotent on the server) until it hits
// 0, showing progress. No single request does unbounded work.
export function useChunkedImport() {
  const t = useT()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  function run(call: () => Promise<ImportResult>) {
    setMsg(null)
    start(async () => {
      let total = 0
      let firstSkipped = 0
      for (let i = 0; i < 5000; i++) {
        const res = await call()
        if (res.error) {
          setMsg(res.error)
          return
        }
        if (i === 0) firstSkipped = res.skipped ?? 0
        total += res.imported ?? 0
        if (!res.remaining) break
        setMsg(t('bank.importingN').replace('{n}', String(total)))
      }
      setMsg(t('bank.imported').replace('{n}', String(total)).replace('{s}', String(firstSkipped)))
      router.refresh()
    })
  }

  return { run, pending, msg }
}
