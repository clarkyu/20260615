'use client'

import { uploadErrorText } from '@/lib/upload-error'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { Video, Mic, Square, Check, CheckCircle2 } from 'lucide-react'
import { getShadowVideoUrl, getShadowTakeUploadUrl, finishShadowing } from '@/actions/submissions'
import { useT } from '@/components/i18n-provider'
import { useChunkLang, ChunkLangToggle, BilingualChunk } from '@/components/bilingual'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

export interface ShadowChunk {
  english: string
  chinese: string | null
  meaningEn: string | null
  meaningZh: string | null
  exampleEn: string | null
  exampleZh: string | null
}

function pickAudioMime(): { mime: string; ext: string } {
  const cands = [
    { mime: 'audio/webm;codecs=opus', ext: 'webm' },
    { mime: 'audio/webm', ext: 'webm' },
    { mime: 'audio/mp4', ext: 'm4a' },
  ]
  const MR = typeof window !== 'undefined' ? window.MediaRecorder : undefined
  for (const c of cands) if (MR && MR.isTypeSupported(c.mime)) return c
  return { mime: '', ext: 'webm' }
}

// One sentence's recorder: record → upload that take → report done.
function SentenceRecorder({ phaseId, order, recorded, onRecorded }: { phaseId: number; order: number; recorded: boolean; onRecorded: () => void }) {
  const t = useT()
  const [phase, setPhase] = useState<'idle' | 'recording' | 'uploading'>('idle')
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const unmountedRef = useRef(false)

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
  }, [])
  useEffect(() => () => { unmountedRef.current = true; cleanup() }, [cleanup])

  const upload = useCallback(async (blob: Blob, ext: string) => {
    setPhase('uploading')
    try {
      const type = blob.type || 'audio/webm'
      const res = await getShadowTakeUploadUrl(phaseId, order, type, blob.type.includes('mp4') ? 'm4a' : ext)
      if ('error' in res || !res.url) { setError(res.error ?? t('rec.uploadFail')); setPhase('idle'); return }
      const put = await fetch(res.url, { method: 'PUT', body: blob, headers: { 'Content-Type': type } })
      if (!put.ok) { setError(`${t('rec.uploadFail')} (${put.status})`); setPhase('idle'); return }
      setPhase('idle')
      onRecorded()
    } catch (e) {
      setError(uploadErrorText(e, t)); setPhase('idle')
    }
  }, [phaseId, order, onRecorded, t])

  const start = useCallback(async () => {
    setError(null)
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setError(t('rec.noSupport')); return }
    cleanup() // stop any prior take's stream before acquiring a new mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (unmountedRef.current) { stream.getTracks().forEach((tr) => tr.stop()); return }
      streamRef.current = stream
      const { mime, ext } = pickAudioMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => { const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'audio/webm' }); cleanup(); void upload(blob, ext) }
      rec.start(); recRef.current = rec; setPhase('recording')
    } catch {
      setError(t('rec.noPermission'))
    }
  }, [cleanup, upload, t])

  return (
    <div className="mt-1.5 flex items-center gap-2">
      {phase === 'recording' ? (
        <Button size="sm" variant="destructive" onClick={() => recRef.current?.stop()}><Square className="h-3.5 w-3.5" />{t('shadow.stop')}</Button>
      ) : phase === 'uploading' ? (
        <Button size="sm" disabled>{t('photo.uploading')}</Button>
      ) : (
        <Button size="sm" variant={recorded ? 'outline' : 'default'} onClick={start}>
          <Mic className="h-3.5 w-3.5" />{recorded ? t('shadow.reRecord') : t('shadow.record')}
        </Button>
      )}
      {recorded ? <span className="inline-flex items-center gap-1 text-xs text-success"><Check className="h-4 w-4" />{t('shadow.recorded')}</span> : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  )
}

export function ShadowSubmit(props: {
  phaseId: number
  title: string
  category: string | null
  instructions: string | null
  chunks: ShadowChunk[]
  attemptsLeft: number
  windowState: 'open' | 'not-open' | 'closed'
  completed: boolean
  latestScore: number | null
  latestFeedback: string | null
  initialRecorded: number[]
}) {
  const t = useT()
  const [url, setUrl] = useState<string | null>(null)
  const [lang, setLang] = useChunkLang()
  const [recorded, setRecorded] = useState<Set<number>>(() => new Set(props.initialRecorded))
  const [phase, setPhase] = useState<'doing' | 'finishing' | 'done'>('doing')
  const [redo, setRedo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startFinish] = useTransition()

  useEffect(() => {
    let active = true
    getShadowVideoUrl(props.phaseId).then((r) => { if (active && r.url) setUrl(r.url) })
    return () => { active = false }
  }, [props.phaseId])

  const total = props.chunks.length
  const doneCount = recorded.size
  // Auto-advance: after a sentence is recorded, scroll the next unrecorded one into view.
  const markRecorded = useCallback((order: number) => {
    setRecorded((s) => {
      const next = new Set(s).add(order)
      const nextIdx = props.chunks.findIndex((_, i) => !next.has(i + 1))
      if (nextIdx >= 0) setTimeout(() => document.getElementById(`shadow-s-${nextIdx + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
      return next
    })
  }, [props.chunks])

  function submit() {
    setPhase('finishing'); setError(null)
    startFinish(async () => {
      const res = await finishShadowing(props.phaseId)
      if (res.error) { setError(res.error); setPhase('doing') }
      else setPhase('done')
    })
  }

  if (props.windowState !== 'open') {
    return (
      <Card>
        <CardHeader><CardTitle>{props.title}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <FormMessage>{props.windowState === 'not-open' ? t('sub.notOpen') : t('sub.closed')}</FormMessage>
          <Link href="/student"><Button variant="outline" className="w-full">{t('back')}</Button></Link>
        </CardContent>
      </Card>
    )
  }

  if (phase === 'done') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="animate-pop grid h-16 w-16 place-items-center rounded-full bg-success/15 text-success"><CheckCircle2 className="h-9 w-9" /></div>
          <p className="text-xl font-bold">{t('rec.success')}</p>
          <p className="text-sm text-muted-foreground">{t('rec.successDesc')}</p>
          <Link href="/student" className="mt-1 w-full"><Button className="w-full" size="lg">{t('sub.backToList')}</Button></Link>
        </CardContent>
      </Card>
    )
  }

  if (props.completed && !redo) {
    return (
      <Card>
        <CardHeader><CardTitle>{props.title}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <FormMessage tone="success">{t('sub.bothDone')}</FormMessage>
          {props.latestScore != null ? (
            <div className="rounded-xl bg-secondary p-3">
              <span className="text-muted-foreground">{t('sub.score')}: </span>
              <span className="text-lg font-bold">{props.latestScore}</span>
              {props.latestFeedback ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{props.latestFeedback}</p> : null}
            </div>
          ) : null}
          {props.attemptsLeft > 0 ? (
            <Button variant="outline" className="w-full" onClick={() => { setRedo(true); setRecorded(new Set()); setPhase('doing') }}>
              {t('sub.redo')}（{t('sub.redoLeft', { n: props.attemptsLeft })}）
            </Button>
          ) : null}
          <Link href="/student"><Button variant="ghost" className="w-full">{t('sub.backToList')}</Button></Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        {props.category ? <Badge tone="primary" className="mb-1">{props.category}</Badge> : null}
        <h1 className="text-xl font-bold tracking-tight">{props.title}</h1>
        {props.instructions ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{props.instructions}</p> : null}
      </div>

      <Card>
        <CardContent className="space-y-3 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-semibold"><Video className="h-4 w-4 text-primary" />{t('shadow.title')}</span>
            <ChunkLangToggle value={lang} onChange={setLang} />
          </div>
          {url ? (
            <video src={url} controls playsInline className="aspect-[3/4] w-full rounded-2xl bg-black object-contain" />
          ) : (
            <Skeleton className="aspect-[3/4] w-full" />
          )}
          <p className="text-xs text-muted-foreground">{t('shadow.recordHint')}</p>
        </CardContent>
      </Card>

      <div className="sticky top-0 z-10 -mx-1 rounded-xl bg-background/90 px-1 py-1.5 backdrop-blur">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{t('shadow.progress')}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${total ? Math.round((doneCount / total) * 100) : 0}%` }} />
          </div>
          <span className="tabular-nums text-muted-foreground">{doneCount}/{total}</span>
        </div>
      </div>

      <ol className="space-y-2">
        {props.chunks.map((c, i) => {
          const order = i + 1
          return (
            <li key={order} id={`shadow-s-${order}`} className="scroll-mt-16 rounded-xl border border-border/70 p-3 text-sm">
              <div className="flex gap-2">
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{order}.</span>
                <BilingualChunk chunk={c} lang={lang} />
              </div>
              <SentenceRecorder phaseId={props.phaseId} order={order} recorded={recorded.has(order)} onRecorded={() => markRecorded(order)} />
            </li>
          )
        })}
      </ol>

      {error ? <FormMessage>{error}</FormMessage> : null}
      <Button className="w-full" size="lg" disabled={phase === 'finishing' || doneCount < total} onClick={submit}>
        {phase === 'finishing' ? t('sub.submitting') : doneCount < total ? t('shadow.recordAll', { n: total - doneCount }) : t('shadow.submit')}
      </Button>
    </div>
  )
}
