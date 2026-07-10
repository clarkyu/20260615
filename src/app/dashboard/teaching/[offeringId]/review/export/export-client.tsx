'use client'

// 学校平台成绩导出(客户端):选模板文件 → 预览核对(server action 试填,回对账报告)→
// 生成下载(fetch POST 同文件到 download 端点,取回已填附件)。
import { useState, useTransition } from 'react'
import { UploadCloud, Download } from 'lucide-react'
import { previewSchoolExport } from '@/actions/review-export'
import type { ExportReport } from '@/lib/domain/review-export'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

const CAT_KEY: Record<string, string> = { classroom: 'review.classroom', training: 'review.training', final: 'review.final' }

export function ReviewExportClient({ offeringId }: { offeringId: number }) {
  const t = useT()
  const [file, setFile] = useState<File | null>(null)
  const [report, setReport] = useState<ExportReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()

  function reset() {
    setReport(null)
    setError(null)
    setDone(false)
  }

  function makeFormData(): FormData {
    const fd = new FormData()
    fd.append('offeringId', String(offeringId))
    if (file) fd.append('file', file)
    return fd
  }

  function onPreview() {
    if (!file) return setError(t('err.pickExcel'))
    reset()
    startTransition(async () => {
      try {
        const res = await previewSchoolExport(null, makeFormData())
        if (res.error) setError(res.error)
        else setReport(res.report ?? null)
      } catch (e) {
        console.error('[review export preview]', e)
        setError(t('err.importFail'))
      }
    })
  }

  function onDownload() {
    if (!file) return
    startTransition(async () => {
      try {
        const resp = await fetch(`/dashboard/teaching/${offeringId}/review/export/download`, {
          method: 'POST',
          body: makeFormData(),
        })
        if (!resp.ok) {
          const txt = (await resp.text()).trim()
          setError(/^(rexp|err)\./.test(txt) ? t(txt) : t('err.importFail'))
          return
        }
        const blob = await resp.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = file.name.replace(/(\.xlsx?)$/i, '-已填$1')
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        setDone(true)
      } catch (e) {
        console.error('[review export download]', e)
        setError(t('err.importFail'))
      }
    })
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-secondary/40 px-4 py-3 text-sm">
          <UploadCloud className="h-5 w-5 text-muted-foreground" />
          <span className="flex-1 truncate text-muted-foreground">{file ? file.name : 'Excel (.xls / .xlsx)'}</span>
          <input
            type="file"
            accept=".xls,.xlsx"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              reset()
            }}
          />
        </label>

        {error ? <FormMessage>{error}</FormMessage> : null}
        {done ? <FormMessage tone="success">{t('rexp.done')}</FormMessage> : null}

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onPreview} disabled={pending || !file}>
            {pending && !report ? t('stu.parsing') : t('rexp.preview')}
          </Button>
          {report ? (
            <Button className="flex-1" onClick={onDownload} disabled={pending}>
              <Download className="mr-1.5 h-4 w-4" />
              {pending ? t('loading') : t('rexp.download')}
            </Button>
          ) : null}
        </div>

        {report ? (
          <div className="space-y-3" aria-live="polite">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge tone="default">
                {t('rexp.templateRows')} {report.templateRows}
              </Badge>
              <Badge tone="success">
                {t('rexp.matchedRows')} {report.matchedRows}
              </Badge>
              <Badge tone="primary">
                {t('rexp.filledCells')} {report.filledCells}
              </Badge>
              {report.unmatched.length > 0 && (
                <Badge tone="warning">
                  {t('rexp.unmatchedN')} {report.unmatched.length}
                </Badge>
              )}
              {report.missing.length > 0 && (
                <Badge tone="warning">
                  {t('rexp.missingN')} {report.missing.length}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t('rexp.mappingNote')}</p>

            {report.unmatched.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium">{t('rexp.unmatchedList')}</p>
                <div className="max-h-40 overflow-auto rounded-xl border border-border p-2 text-xs text-muted-foreground">
                  {report.unmatched.map((r) => (
                    <span key={r.studentNo} className="mr-3 inline-block tabular-nums">
                      {r.studentNo} {r.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {report.missing.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium">{t('rexp.missingList')}</p>
                <div className="max-h-40 overflow-auto rounded-xl border border-border p-2 text-xs text-muted-foreground">
                  {report.missing.map((r) => (
                    <p key={r.studentNo} className="tabular-nums">
                      {r.studentNo} {r.name} — {r.cats.map((c) => t(CAT_KEY[c] ?? c)).join(' / ')}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
