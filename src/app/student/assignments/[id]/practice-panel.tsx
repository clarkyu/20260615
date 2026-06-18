'use client'

import { useCallback, useRef, useState } from 'react'
import { Sparkles, Mic, Square, RotateCcw, CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import { getPracticeUploadUrl, gradePracticeAttempt, type PracticeFeedback } from '@/actions/practice'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface Sentence {
  order: number
  text: string
}

type Phase = 'idle' | 'recording' | 'grading' | 'feedback'

function pickAudioMime(): { mime: string; ext: string } {
  const candidates = [
    { mime: 'audio/webm;codecs=opus', ext: 'webm' },
    { mime: 'audio/webm', ext: 'webm' },
    { mime: 'audio/mp4', ext: 'm4a' },
  ]
  const MR = typeof window !== 'undefined' ? window.MediaRecorder : undefined
  for (const c of candidates) if (MR && MR.isTypeSupported(c.mime)) return c
  return { mime: '', ext: 'webm' }
}

// "练一练": record a reading, get instant AI feedback, retry as much as you like.
// Never consumes a formal submission attempt.
export function PracticePanel({ phaseId, sentences }: { phaseId: number; sentences: Sentence[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PracticeFeedback | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef(0)

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  const grade = useCallback(
    async (blob: Blob, ext: string) => {
      setPhase('grading')
      setError(null)
      try {
        const type = blob.type || 'audio/webm'
        const up = await getPracticeUploadUrl(phaseId, type, blob.type.includes('mp4') ? 'm4a' : ext)
        if ('error' in up || !up.url) {
          setError(up.error ?? t('rec.uploadFail'))
          setPhase('idle')
          return
        }
        const put = await fetch(up.url, { method: 'PUT', body: blob, headers: { 'Content-Type': type } })
        if (!put.ok) {
          setError(t('rec.uploadFail'))
          setPhase('idle')
          return
        }
        const fb = await gradePracticeAttempt(phaseId, { kind: 'audio', mediaKey: up.key })
        setResult(fb)
        setPhase('feedback')
      } catch {
        setError(t('rec.uploadFail'))
        setPhase('idle')
      }
    },
    [phaseId, t],
  )

  const start = useCallback(async () => {
    setError(null)
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(t('rec.noSupport'))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const { mime, ext } = pickAudioMime()
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'audio/webm' })
        cleanup()
        void grade(blob, ext)
      }
      recorder.start()
      recorderRef.current = recorder
      startedAtRef.current = Date.now()
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000)
      setPhase('recording')
    } catch {
      setError(t('rec.noPermission'))
    }
  }, [t, cleanup, grade])

  const stop = useCallback(() => {
    recorderRef.current?.stop()
  }, [])

  const reset = useCallback(() => {
    setResult(null)
    setError(null)
    setPhase('idle')
  }, [])

  if (!open) {
    return (
      <Card
        className="tap border-primary/30 bg-primary/5 hover:shadow-card"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) } }}
      >
        <CardContent className="flex items-center gap-3 p-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-snug">{t('practice.cardTitle')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('practice.cardDesc')}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-semibold">{t('practice.cardTitle')}</span>
          <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
            {t('practice.noCount')}
          </span>
        </div>

        {phase === 'idle' ? (
          <>
            <p className="text-sm text-muted-foreground">{t('practice.hint')}</p>
            {sentences.length > 0 ? (
              <details className="rounded-xl bg-secondary/60 p-3 text-sm">
                <summary className="cursor-pointer font-medium">{t('practice.reference')}</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                  {sentences.map((s) => (
                    <li key={s.order}>{s.text}</li>
                  ))}
                </ol>
              </details>
            ) : null}
            {error ? <FormMessage>{error}</FormMessage> : null}
            <Button className="w-full" size="lg" onClick={start}>
              <Mic className="h-4 w-4" />
              {t('practice.start')}
            </Button>
          </>
        ) : null}

        {phase === 'recording' ? (
          <div className="space-y-3">
            <div className="grid aspect-[5/2] w-full place-items-center rounded-2xl bg-secondary">
              <Mic className="h-12 w-12 animate-pulse text-red-500" />
              <div className="absolute mt-24 flex items-center gap-1.5 text-sm font-semibold tabular-nums text-muted-foreground">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                {elapsed}s
              </div>
            </div>
            <Button className="w-full" size="lg" variant="destructive" onClick={stop}>
              <Square className="h-4 w-4" />
              {t('practice.stop')}
            </Button>
          </div>
        ) : null}

        {phase === 'grading' ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Sparkles className="h-8 w-8 animate-pulse text-primary" />
            <p className="text-sm text-muted-foreground">{t('practice.grading')}</p>
          </div>
        ) : null}

        {phase === 'feedback' && result ? (
          <div className="space-y-3">
            <FeedbackView result={result} sentences={sentences} />
            <Button className="w-full" variant="outline" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
              {t('practice.again')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function FeedbackView({ result, sentences }: { result: PracticeFeedback; sentences: Sentence[] }) {
  const t = useT()

  if (result.status === 'unavailable') {
    return (
      <div className="space-y-2 rounded-xl border border-border/70 bg-secondary/40 p-3">
        <div className="flex items-center gap-2 font-medium">
          <Info className="h-4 w-4 text-muted-foreground" />
          {t('practice.unavailable')}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('practice.unavailableDesc')}</p>
      </div>
    )
  }

  if (result.status === 'error') {
    return <FormMessage>{result.message}</FormMessage>
  }

  const byOrder = new Map(result.perSentence.map((p) => [p.order, p]))

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between rounded-2xl bg-primary/5 p-3">
        <div>
          <div className="text-xs text-muted-foreground">{t('practice.aiScore')}</div>
          <div className="text-4xl font-extrabold leading-none tabular-nums text-primary">{result.score}</div>
        </div>
        {result.confidence != null ? (
          <div className="text-right text-xs text-muted-foreground">
            {t('practice.confidence')}
            <div className="text-sm font-semibold text-foreground tabular-nums">{Math.round(result.confidence * 100)}%</div>
          </div>
        ) : null}
      </div>

      {result.breakdown && Object.keys(result.breakdown).length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(result.breakdown).map(([k, v]) => (
            <span key={k} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium">
              {k} <span className="font-bold tabular-nums">{v}</span>
            </span>
          ))}
        </div>
      ) : null}

      {sentences.length > 0 ? (
        <ul className="space-y-1.5">
          {sentences.map((s) => {
            const p = byOrder.get(s.order)
            const weak = p ? p.accuracy < 0.6 || p.completeness < 0.6 : false
            return (
              <li key={s.order} className="flex items-start gap-2 text-sm">
                {weak ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--warning))]" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                )}
                <span className={weak ? 'text-foreground' : 'text-muted-foreground'}>{s.text}</span>
              </li>
            )
          })}
        </ul>
      ) : null}

      {result.feedback ? (
        <p className="rounded-xl bg-secondary/60 p-3 text-sm leading-relaxed">{result.feedback}</p>
      ) : null}

      {result.transcript ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">{t('practice.transcript')}</summary>
          <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-secondary p-2 font-sans">{result.transcript}</pre>
        </details>
      ) : null}
    </div>
  )
}
