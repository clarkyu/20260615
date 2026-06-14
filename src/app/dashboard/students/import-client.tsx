'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { previewRoster, commitRoster } from '@/actions/students'
import type { RosterRow } from '@/lib/roster'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function ImportClient() {
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
    if (!file) {
      setError('请选择 Excel 文件（.xlsx）')
      return
    }
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
        setResult(`导入完成：新增 ${res.created} 人，更新 ${res.updated} 人，跳过 ${res.skipped} 行，涉及班级 ${res.classesTouched} 个。`)
        setRows(null)
        router.refresh()
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">导入名单</CardTitle>
        <CardDescription>Excel 需含「学号、姓名、班级」列，可选「院系、专业」。先预览再确认导入。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            reset()
          }}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
        />

        {error ? <FormMessage>{error}</FormMessage> : null}
        {result ? <FormMessage tone="success">{result}</FormMessage> : null}

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onPreview} disabled={pending || !file}>
            {pending && !rows ? '解析中…' : '预览'}
          </Button>
          {rows && counts && counts.valid > 0 ? (
            <Button className="flex-1" onClick={onCommit} disabled={pending}>
              {pending ? '导入中…' : `确认导入 ${counts.valid} 人`}
            </Button>
          ) : null}
        </div>

        {rows && counts ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              共 {rows.length} 行，可导入 {counts.valid}，有问题 {counts.error}。
            </p>
            <div className="max-h-72 overflow-auto rounded-md border text-sm">
              <table className="w-full">
                <thead className="sticky top-0 bg-secondary text-left text-xs">
                  <tr>
                    <th className="px-2 py-1">学号</th>
                    <th className="px-2 py-1">姓名</th>
                    <th className="px-2 py-1">班级</th>
                    <th className="px-2 py-1">问题</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((r) => (
                    <tr key={r.rowNumber} className={r.error ? 'bg-destructive/10' : ''}>
                      <td className="px-2 py-1">{r.studentNo}</td>
                      <td className="px-2 py-1">{r.name}</td>
                      <td className="px-2 py-1">{r.className}</td>
                      <td className="px-2 py-1 text-destructive">{r.error ?? ''}</td>
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
