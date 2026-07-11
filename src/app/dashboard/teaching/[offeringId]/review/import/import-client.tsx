'use client'

// 雨课堂导入(客户端):选文件 → 解析预览(节次口径/两向名单/警示/预估分布)→ 确认落库。
// 与花名册导入同一模式:预览与确认各自把文件重传给 server action 重解析。
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { UploadCloud } from 'lucide-react'
import { previewClassPerfImport, commitClassPerfImport } from '@/actions/class-perf'
import type { ImportPreview } from '@/lib/domain/class-perf-import'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

// parser 警示为「key:载荷」——按首个冒号拆开,key 走翻译、载荷原样拼接。
function warnText(t: (k: string) => string, w: string): string {
  const i = w.indexOf(':')
  if (i < 0) return t(w)
  return `${t(w.slice(0, i))} ${w.slice(i + 1)}`
}

function NameList({ title, rows }: { title: string; rows: { studentNo: string; name: string }[] }) {
  if (rows.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">{title}</p>
      <div className="max-h-40 overflow-auto rounded-xl border border-border p-2 text-xs text-muted-foreground">
        {rows.map((r) => (
          <span key={r.studentNo} className="mr-3 inline-block tabular-nums">
            {r.studentNo} {r.name}
          </span>
        ))}
      </div>
    </div>
  )
}

export function RainImportClient({ offeringId }: { offeringId: number }) {
  const t = useT()
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function reset() {
    setPreview(null)
    setError(null)
    setResult(null)
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
        const res = await previewClassPerfImport(null, makeFormData())
        if (res.error) setError(res.error)
        else setPreview(res.preview ?? null)
      } catch (e) {
        console.error('[rain preview]', e)
        setError(t('err.importFail'))
      }
    })
  }

  function onCommit() {
    if (!file) return
    startTransition(async () => {
      try {
        const res = await commitClassPerfImport(null, makeFormData())
        if (res.error) setError(res.error)
        else {
          setResult(t('rain.done', { n: res.rowCount ?? 0, m: res.matchedCount ?? 0 }))
          setPreview(null)
          router.refresh()
        }
      } catch (e) {
        console.error('[rain commit]', e)
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
        {result ? (
          <div className="space-y-2">
            <FormMessage tone="success">{result}</FormMessage>
            <Link href={`/dashboard/teaching/${offeringId}/review`} className="inline-block text-sm font-medium text-primary hover:underline">
              {t('rain.backToReview')}
            </Link>
          </div>
        ) : null}

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onPreview} disabled={pending || !file}>
            {pending && !preview ? t('stu.parsing') : t('rain.preview')}
          </Button>
          {preview && preview.matchedCount > 0 ? (
            <Button className="flex-1" onClick={onCommit} disabled={pending}>
              {pending ? t('loading') : `${t('rain.confirm')} (${preview.matchedCount})`}
            </Button>
          ) : null}
        </div>

        {preview ? (
          <div className="space-y-3" aria-live="polite">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge tone="default">
                {t('rain.students')} {preview.rowCount}
              </Badge>
              <Badge tone="success">
                {t('rain.matched')} {preview.matchedCount}
              </Badge>
              {preview.unmatched.length > 0 && (
                <Badge tone="warning">
                  {t('rain.unmatchedN')} {preview.unmatched.length}
                </Badge>
              )}
              {preview.duplicateCount > 0 && (
                <Badge tone="muted">
                  {t('rain.duplicatedN')} {preview.duplicateCount}
                </Badge>
              )}
              {preview.corrections.length > 0 && (
                <Badge tone="primary">
                  {t('rain.correctedN')} {preview.corrections.length}
                </Badge>
              )}
              {preview.merges.length > 0 && (
                <Badge tone="primary">
                  {t('rain.mergedN')} {preview.merges.length}
                </Badge>
              )}
              <Badge tone="default">
                {t('rain.sessionsCounted')} {preview.countedSessions}
                {preview.declaredSessions != null ? ` / ${t('rain.declared')} ${preview.declaredSessions}` : ''}
              </Badge>
              {preview.scoreMean != null && (
                <Badge tone="primary">
                  {t('rain.scoreMean')} {preview.scoreMean.toFixed(1)}
                </Badge>
              )}
            </div>

            <p className="text-xs text-muted-foreground">{t('rain.weightsNote')}</p>

            {preview.warnings.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-amber-600 dark:text-amber-500">{t('rain.warnings')}</p>
                <ul className="list-inside list-disc text-xs text-muted-foreground">
                  {preview.warnings.map((w) => (
                    <li key={w}>{warnText(t, w)}</li>
                  ))}
                </ul>
              </div>
            )}

            {preview.corrections.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium">{t('rain.correctionsList')}</p>
                <div className="max-h-40 overflow-auto rounded-xl border border-border p-2 text-xs text-muted-foreground">
                  {preview.corrections.map((c, i) => (
                    <p key={i} className="tabular-nums">
                      {c.fromNo} {c.fromName} → {c.toNo} {c.toName}
                      <span className="ml-1 text-[10px]">
                        ({c.via === 'name' ? t('rain.viaName') : c.via === 'no' ? t('rain.viaNo') : t('rain.viaNameNo')})
                      </span>
                    </p>
                  ))}
                </div>
              </div>
            )}
            {preview.merges.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium">{t('rain.mergesList')}</p>
                <div className="max-h-40 overflow-auto rounded-xl border border-border p-2 text-xs text-muted-foreground">
                  {preview.merges.map((m) => (
                    <span key={m.studentNo} className="mr-3 inline-block tabular-nums">
                      {m.studentNo} {m.name} ×{m.rows}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <NameList title={t('rain.unmatchedList')} rows={preview.unmatched} />
            <NameList title={t('rain.missingList')} rows={preview.missingFromFile} />
            <NameList title={t('rain.flooredList')} rows={preview.floored} />

            <div className="overflow-hidden rounded-xl border border-border">
              <div className="max-h-72 overflow-auto text-sm">
                <table className="w-full">
                  <thead className="sticky top-0 bg-secondary text-left text-xs">
                    <tr>
                      <th className="px-3 py-2">{t('rain.colSession')}</th>
                      <th className="px-3 py-2">{t('rain.colDate')}</th>
                      <th className="px-3 py-2">{t('rain.colCounted')}</th>
                      <th className="px-3 py-2">{t('rain.colDanmaku')}</th>
                      <th className="px-3 py-2">{t('rain.colPosts')}</th>
                      <th className="px-3 py-2">{t('rain.colQuestions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sessions.map((s, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="max-w-56 truncate px-3 py-1.5" title={s.label}>
                          {s.label}
                        </td>
                        <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{s.date ?? '—'}</td>
                        <td className="px-3 py-1.5">
                          {s.counted ? <Badge tone="success">{t('rain.yes')}</Badge> : <Badge tone="muted">{t('rain.no')}</Badge>}
                        </td>
                        <td className="px-3 py-1.5">{s.danmakuOpen ? '✓' : '—'}</td>
                        <td className="px-3 py-1.5">{s.postOpen ? '✓' : '—'}</td>
                        <td className="px-3 py-1.5 tabular-nums">{s.questions > 0 ? s.questions : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
