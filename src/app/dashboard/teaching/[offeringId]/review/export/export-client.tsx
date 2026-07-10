'use client'

// 学校平台成绩导出(客户端):选模板文件 → 预览核对(mode=preview 到同一端点,回对账报告)→
// 生成下载(同端点回附件 + X-Export-Report 计数头,与预览比对——数据在预览后被改动能当场发现)。
// 预览与下载走同一条服务端代码路径,报告口径不分叉;server action 有 1MB 体积上限故不用。
import { useRef, useState, useTransition } from 'react'
import { UploadCloud, Download } from 'lucide-react'
import type { ExportReport } from '@/lib/domain/review-export'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

const CAT_KEY: Record<string, string> = { classroom: 'review.classroom', training: 'review.training', final: 'review.final' }
const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024 // 与服务端一致;超限本地即拒,不白传

const counts = (r: ExportReport) => ({ t: r.templateRows, m: r.matchedRows, f: r.filledCells, u: r.unmatched.length, x: r.missing.length })

export function ReviewExportClient({ offeringId }: { offeringId: number }) {
  const t = useT()
  const [file, setFile] = useState<File | null>(null)
  const [report, setReport] = useState<ExportReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()
  // 预览请求序号:响应回来若已不是最新一次(用户换了文件),整包丢弃——防止 A 文件的
  // 报告顶着 B 文件的名字展示、进而下载了未核对的文件。
  const seq = useRef(0)

  function reset() {
    setReport(null)
    setError(null)
    setWarn(null)
    setDone(false)
  }

  function makeFormData(mode?: 'preview'): FormData {
    const fd = new FormData()
    if (file) fd.append('file', file)
    if (mode) fd.append('mode', mode)
    return fd
  }

  async function readError(resp: Response): Promise<string> {
    const txt = (await resp.text()).trim()
    return /^(rexp|err)\./.test(txt) ? t(txt) : t('err.importFail')
  }

  function onPreview() {
    if (!file) return setError(t('err.pickExcel'))
    if (file.size > MAX_TEMPLATE_BYTES) return setError(t('rexp.errTooBig'))
    reset()
    const mySeq = ++seq.current
    startTransition(async () => {
      try {
        const resp = await fetch(`/dashboard/teaching/${offeringId}/review/export/download`, {
          method: 'POST',
          body: makeFormData('preview'),
        })
        if (mySeq !== seq.current) return // 已换文件,过期响应整包丢弃
        if (!resp.ok) {
          setError(await readError(resp))
          return
        }
        const json = (await resp.json()) as { report?: ExportReport }
        if (mySeq !== seq.current) return
        setReport(json.report ?? null)
      } catch (e) {
        console.error('[review export preview]', e)
        if (mySeq === seq.current) setError(t('err.importFail'))
      }
    })
  }

  function onDownload() {
    if (!file || !report) return
    setError(null)
    setWarn(null)
    setDone(false)
    startTransition(async () => {
      try {
        const resp = await fetch(`/dashboard/teaching/${offeringId}/review/export/download`, {
          method: 'POST',
          body: makeFormData(),
        })
        if (!resp.ok) {
          setError(await readError(resp))
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
        // 下载响应带回本次实算计数:与预览时的报告比对,期间有人改了分/换了导入立刻可见。
        const fresh = resp.headers.get('X-Export-Report')
        if (fresh && report && fresh !== JSON.stringify(counts(report))) {
          setWarn(t('rexp.warnChanged'))
        } else {
          setDone(true)
        }
      } catch (e) {
        console.error('[review export download]', e)
        setError(t('err.importFail'))
      }
    })
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <label
          className={`flex items-center gap-3 rounded-xl border border-dashed border-border bg-secondary/40 px-4 py-3 text-sm ${pending ? 'opacity-60' : 'cursor-pointer'}`}
        >
          <UploadCloud className="h-5 w-5 text-muted-foreground" />
          <span className="flex-1 truncate text-muted-foreground">{file ? file.name : 'Excel (.xls / .xlsx)'}</span>
          <input
            type="file"
            accept=".xls,.xlsx"
            className="hidden"
            disabled={pending}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              seq.current++ // 使在途预览响应作废
              reset()
            }}
          />
        </label>

        {error ? <FormMessage>{error}</FormMessage> : null}
        {warn ? <FormMessage>{warn}</FormMessage> : null}
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
