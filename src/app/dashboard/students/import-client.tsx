'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UploadCloud } from 'lucide-react'
import { previewRoster, commitRoster } from '@/actions/students'
import type { RosterRow } from '@/lib/roster'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardDescription, CardTitle } from '@/components/ui/card'

export function ImportClient() {
  const t = useT()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<RosterRow[] | null>(null)
  const [counts, setCounts] = useState<{ valid: number; error: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function reset() {
    setRows(null)
    setCounts(null)
    setResult(null)
    setError(null)
  }

  function onPreview() {
    if (!file) return setError(t('stu.import'))
    reset()
    startTransition(async () => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await previewRoster(null, fd)
      if (res.error) setError(res.error)
      else {
        setRows(res.rows ?? [])
        setCounts({ valid: res.validCount ?? 0, error: res.errorCount ?? 0 })
      }
    })
  }

  function onCommit() {
    if (!file) return
    startTransition(async () => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await commitRoster(null, fd)
      if (res.error) setError(res.error)
      else {
        setResult(`+${res.created} · ↻${res.updated} · ⏭${res.skipped}`)
        setRows(null)
        router.refresh()
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('stu.import')}</CardTitle>
        <CardDescription>{t('stu.importDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-secondary/40 px-4 py-3 text-sm">
          <UploadCloud className="h-5 w-5 text-muted-foreground" />
          <span className="flex-1 truncate text-muted-foreground">{file ? file.name : 'Excel (.xlsx)'}</span>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset() }}
          />
        </label>

        {error ? <FormMessage>{error}</FormMessage> : null}
        {result ? <FormMessage tone="success">{result}</FormMessage> : null}

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onPreview} disabled={pending || !file}>
            {pending && !rows ? t('stu.parsing') : t('stu.preview')}
          </Button>
          {rows && counts && counts.valid > 0 ? (
            <Button className="flex-1" onClick={onCommit} disabled={pending}>
              {pending ? t('loading') : `${t('stu.confirm')} ${counts.valid}`}
            </Button>
          ) : null}
        </div>

        {rows && counts ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="max-h-72 overflow-auto text-sm">
              <table className="w-full">
                <thead className="sticky top-0 bg-secondary text-left text-xs">
                  <tr>
                    <th className="px-3 py-2">{t('stu.colNo')}</th>
                    <th className="px-3 py-2">{t('stu.colName')}</th>
                    <th className="px-3 py-2">{t('stu.colClass')}</th>
                    <th className="px-3 py-2">{t('stu.colIssue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((r) => (
                    <tr key={r.rowNumber} className={r.error ? 'bg-destructive/8' : 'border-t border-border/50'}>
                      <td className="px-3 py-1.5">{r.studentNo}</td>
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5">{r.className}</td>
                      <td className="px-3 py-1.5 text-destructive">{r.error ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
