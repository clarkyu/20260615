'use client'

import { useEffect, useState } from 'react'
import { Languages, Video } from 'lucide-react'
import { getShadowVideoUrl } from '@/actions/submissions'
import { useT } from '@/components/i18n-provider'
import { Card, CardContent } from '@/components/ui/card'

export interface ShadowChunk {
  english: string
  chinese: string | null
  meaningEn: string | null
  meaningZh: string | null
  exampleEn: string | null
  exampleZh: string | null
}

// 跟读呈现：上半部分跟读视频，下半部分三段式句子（中英对照，中文可开关）。
export function ShadowingReference({ assignmentId, chunks }: { assignmentId: number; chunks: ShadowChunk[] }) {
  const t = useT()
  const [url, setUrl] = useState<string | null>(null)
  const [showZh, setShowZh] = useState(true)

  useEffect(() => {
    let active = true
    getShadowVideoUrl(assignmentId).then((r) => {
      if (active && r.url) setUrl(r.url)
    })
    return () => {
      active = false
    }
  }, [assignmentId])

  return (
    <Card>
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-semibold"><Video className="h-4 w-4 text-primary" />{t('shadow.title')}</span>
          <button type="button" onClick={() => setShowZh((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-primary">
            <Languages className="h-3.5 w-3.5" />{showZh ? t('shadow.hideZh') : t('shadow.showZh')}
          </button>
        </div>

        {url ? (
          <video src={url} controls playsInline className="aspect-[3/4] w-full rounded-2xl bg-black object-contain" />
        ) : (
          <div className="grid aspect-[3/4] w-full place-items-center rounded-2xl bg-secondary text-sm text-muted-foreground">{t('loading')}</div>
        )}

        <ol className="space-y-2">
          {chunks.map((c, i) => (
            <li key={i} className="rounded-xl bg-secondary/50 p-2.5 text-sm">
              <div className="font-semibold">{i + 1}. {c.english}</div>
              {showZh && c.chinese ? <div className="mt-0.5 text-xs text-muted-foreground">{c.chinese}</div> : null}
              {c.meaningEn ? (
                <div className="mt-1 text-xs">{c.meaningEn}{showZh && c.meaningZh ? <span className="text-muted-foreground"> / {c.meaningZh}</span> : null}</div>
              ) : null}
              {c.exampleEn ? (
                <div className="mt-0.5 text-xs italic">{c.exampleEn}{showZh && c.exampleZh ? <span className="not-italic text-muted-foreground"> / {c.exampleZh}</span> : null}</div>
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
