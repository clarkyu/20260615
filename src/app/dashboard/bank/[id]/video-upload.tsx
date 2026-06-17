'use client'

import { useRef, useState } from 'react'
import { Video, CheckCircle2, Upload } from 'lucide-react'
import { getChunkSetVideoUrl } from '@/actions/bank'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

// Uploads the single shadowing video for a chunk set straight to R2.
export function VideoUpload({ chunkSetId, hasVideo }: { chunkSetId: number; hasVideo: boolean }) {
  const t = useT()
  const [done, setDone] = useState(hasVideo)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  async function onPick(file: File) {
    setBusy(true)
    setError(null)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || (file.type.includes('mp4') ? 'mp4' : 'webm')
      const type = file.type || 'video/mp4'
      const res = await getChunkSetVideoUrl(chunkSetId, type, ext)
      if ('error' in res || !res.url) {
        setError(res.error ?? t('rec.uploadFail'))
        return
      }
      const put = await fetch(res.url, { method: 'PUT', body: file, headers: { 'Content-Type': type } })
      if (!put.ok) {
        setError(`${t('rec.uploadFail')} (${put.status})`)
        return
      }
      setDone(true)
    } catch (e) {
      setError(`${t('rec.uploadFail')} · ${e instanceof Error ? e.name : 'network'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={done ? 'border-success/40' : 'border-primary/30'}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-sm">
          {done ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Video className="h-4 w-4 text-primary" />}
          <span className="font-medium">{done ? t('bank.videoUploaded') : t('bank.uploadVideo')}</span>
        </div>
        <input
          ref={ref}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onPick(f)
          }}
        />
        {error ? <FormMessage>{error}</FormMessage> : null}
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => ref.current?.click()}>
          <Upload className="h-4 w-4" />{busy ? t('bank.uploading') : done ? t('bank.replaceVideo') : t('bank.pickVideo')}
        </Button>
      </CardContent>
    </Card>
  )
}
