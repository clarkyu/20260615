'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, ImageUp } from 'lucide-react'
import { getUploadUrl, recordMedia } from '@/actions/submissions'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

function extFor(type: string): string {
  if (type.includes('png')) return 'png'
  if (type.includes('webp')) return 'webp'
  if (type.includes('heic')) return 'heic'
  return 'jpg'
}

export function PhotoStep({ assignmentId, onDone }: { assignmentId: number; onDone: () => void }) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Revoke the preview object URL on unmount (re-picks revoke the prior one inline).
  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current) }, [])

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    const url = URL.createObjectURL(f)
    previewUrlRef.current = url
    setPreview(url)
    setError(null)
  }

  async function submit() {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const type = file.type || 'image/jpeg'
      const res = await getUploadUrl(assignmentId, 'image', type, extFor(type))
      if ('error' in res || !res.url) { setError(res.error ?? 'upload failed'); setBusy(false); return }
      const put = await fetch(res.url, { method: 'PUT', body: file, headers: { 'Content-Type': type } })
      if (!put.ok) { setError(t('rec.uploadFail')); setBusy(false); return }
      const fin = await recordMedia(res.submissionId, 'image', file.size, 0, '[]')
      if ('error' in fin && fin.error) { setError(fin.error); setBusy(false); return }
      onDone()
    } catch {
      setError(t('rec.uploadFail')); setBusy(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-sm text-muted-foreground">{t('photo.hint')}</p>
        <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={onPick} className="hidden" />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-label={t('photo.pick')}
          className="grid aspect-[3/4] w-full cursor-pointer place-items-center overflow-hidden rounded-2xl border border-dashed border-input bg-secondary/40"
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-full w-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Camera className="h-10 w-10" />
              <span className="text-sm">{t('photo.pick')}</span>
            </div>
          )}
        </button>
        {error ? <FormMessage>{error}</FormMessage> : null}
        {preview ? (
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => inputRef.current?.click()}>{t('photo.retake')}</Button>
            <Button className="flex-1" size="lg" disabled={busy} onClick={submit}>{busy ? t('photo.uploading') : t('submit')}</Button>
          </div>
        ) : (
          <Button className="w-full" size="lg" onClick={() => inputRef.current?.click()}><ImageUp className="h-4 w-4" />{t('photo.pick')}</Button>
        )}
      </CardContent>
    </Card>
  )
}
