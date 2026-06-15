'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Eye, ListChecks, Video } from 'lucide-react'
import { getUploadUrl, finalizeSubmission } from '@/actions/submissions'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface Sentence {
  order: number
  text: string
}

type Phase = 'review' | 'countdown' | 'recording' | 'recorded' | 'uploading' | 'done'

interface Violation {
  type: string
  at: number
}

function pickMimeType(): { mime: string; ext: string } {
  const candidates: Array<{ mime: string; ext: string }> = [
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
    { mime: 'video/mp4', ext: 'mp4' },
  ]
  const MR = typeof window !== 'undefined' ? window.MediaRecorder : undefined
  for (const c of candidates) if (MR && MR.isTypeSupported(c.mime)) return c
  return { mime: '', ext: 'webm' }
}

export function Recorder(props: {
  assignmentId: number
  title: string
  sentences: Sentence[]
  requireEyesClosed: boolean
  attemptsLeft: number
  latestStatus: string | null
  latestScore: number | null
  latestFeedback: string | null
  windowState: 'open' | 'not-open' | 'closed'
}) {
  const t = useT()
  const [phase, setPhase] = useState<Phase>('review')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [count, setCount] = useState(3)
  const [violations, setViolations] = useState<Violation[]>([])

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)
  const startedAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const addViolation = useCallback((type: string) => {
    setViolations((v) => [...v, { type, at: Date.now() }])
  }, [])

  useEffect(() => {
    if (phase !== 'recording') return
    const onHide = () => { if (document.visibilityState === 'hidden') addViolation('visibility-hidden') }
    const onBlur = () => addViolation('window-blur')
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('blur', onBlur)
    }
  }, [phase, addViolation])

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  useEffect(() => () => cleanupStream(), [cleanupStream])

  // Actually start the MediaRecorder (camera stream is already live by now).
  const beginRecord = useCallback(() => {
    const stream = streamRef.current
    if (!stream) { setPhase('review'); return }
    const { mime } = pickMimeType()
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    chunksRef.current = []
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    recorder.onstop = () => {
      blobRef.current = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'video/webm' })
      setPhase('recorded')
      cleanupStream()
      if (videoRef.current) {
        videoRef.current.srcObject = null
        videoRef.current.src = URL.createObjectURL(blobRef.current)
        videoRef.current.muted = false
        videoRef.current.controls = true
      }
    }
    recorder.start()
    recorderRef.current = recorder
    startedAtRef.current = Date.now()
    setElapsed(0)
    setViolations([])
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000)
    setPhase('recording')
    document.documentElement.requestFullscreen?.().catch(() => {})
  }, [cleanupStream])

  // 3-2-1 countdown while the live preview is already showing.
  useEffect(() => {
    if (phase !== 'countdown') return
    if (count <= 0) { beginRecord(); return }
    const id = setTimeout(() => setCount((c) => c - 1), 850)
    return () => clearTimeout(id)
  }, [phase, count, beginRecord])

  // Turn on the camera, show the mirror preview, then run the countdown.
  const arm = useCallback(async () => {
    setError(null)
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(t('rec.noSupport'))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.muted = true
        videoRef.current.controls = false
        await videoRef.current.play().catch(() => {})
      }
      setCount(3)
      setPhase('countdown')
    } catch {
      setError(t('rec.noPermission'))
    }
  }, [t])

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop()
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }, [])

  const submit = useCallback(async () => {
    const blob = blobRef.current
    if (!blob) return
    setPhase('uploading')
    setError(null)
    const { ext } = pickMimeType()
    const fileExt = blob.type.includes('mp4') ? 'mp4' : ext
    try {
      const res = await getUploadUrl(props.assignmentId, blob.type || 'video/webm', fileExt)
      if ('error' in res || !res.url) {
        setError(res.error ?? 'upload failed')
        setPhase('recorded')
        return
      }
      const put = await fetch(res.url, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'video/webm' } })
      if (!put.ok) {
        setError(t('rec.uploadFail'))
        setPhase('recorded')
        return
      }
      const fin = await finalizeSubmission(res.submissionId, blob.size, elapsed, JSON.stringify(violations))
      if ('error' in fin && fin.error) {
        setError(fin.error)
        setPhase('recorded')
        return
      }
      setPhase('done')
    } catch {
      setError(t('rec.uploadFail'))
      setPhase('recorded')
    }
  }, [props.assignmentId, elapsed, violations, t])

  if (phase === 'done') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="animate-in-up grid h-16 w-16 place-items-center rounded-full bg-success/15 text-success">
            <CheckCircle2 className="h-9 w-9" />
          </div>
          <p className="text-xl font-bold">{t('rec.success')}</p>
          <p className="text-sm text-muted-foreground">{t('rec.successDesc')}</p>
          <Link href="/student" className="mt-1 w-full">
            <Button className="w-full" size="lg">{t('sub.backToList')}</Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  const live = phase === 'countdown' || phase === 'recording'
  const banner = props.requireEyesClosed ? t('rec.eyesBanner') : t('rec.reciteBanner')

  return (
    <div className="space-y-3">
      {phase === 'review' ? (
        <Card>
          <CardContent className="space-y-3 p-4 text-sm">
            <p className="flex items-start gap-2 text-muted-foreground">
              <Video className="mt-0.5 h-4 w-4 shrink-0" />
              {t('rec.requirement', { eyes: props.requireEyesClosed ? t('rec.eyesClosed') : t('rec.recite') })}
            </p>
            {props.sentences.length > 0 ? (
              <details className="rounded-xl bg-secondary/60 p-3">
                <summary className="flex cursor-pointer items-center gap-2 font-medium text-foreground">
                  <ListChecks className="h-4 w-4" />{t('rec.review', { n: props.sentences.length })}
                </summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                  {props.sentences.map((s) => <li key={s.order}>{s.text}</li>)}
                </ol>
              </details>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardContent className="space-y-3 p-4">
          <div className="relative overflow-hidden rounded-2xl bg-black">
            <video
              ref={videoRef}
              playsInline
              className={'aspect-[3/4] w-full object-cover ' + (live ? '-scale-x-100' : '')}
            />

            {/* Recording chip */}
            {phase === 'recording' ? (
              <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                {elapsed}s
                {violations.length > 0 ? <span className="text-amber-300">· ⚠️ {violations.length}</span> : null}
              </div>
            ) : null}

            {/* On-camera prompt during recording */}
            {phase === 'recording' ? (
              <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-2 bg-gradient-to-b from-black/55 to-transparent py-3 text-sm font-semibold text-white">
                {props.requireEyesClosed ? <Eye className="h-4 w-4" /> : null}{banner}
              </div>
            ) : null}

            {/* Countdown overlay */}
            {phase === 'countdown' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 text-white">
                <span key={count} className="animate-in-up text-7xl font-black tabular-nums">{count > 0 ? count : ''}</span>
                <span className="text-sm font-medium opacity-90">{t('rec.getReady')}</span>
              </div>
            ) : null}

            {/* Idle placeholder */}
            {phase === 'review' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70">
                <Video className="h-10 w-10" />
                <span className="px-6 text-center text-xs">{t('rec.countHint')}</span>
              </div>
            ) : null}
          </div>

          {error ? <FormMessage>{error}</FormMessage> : null}

          {props.attemptsLeft <= 0 && phase === 'review' ? (
            <FormMessage>{t('rec.usedUp')}</FormMessage>
          ) : phase === 'review' ? (
            <Button className="w-full" size="lg" onClick={arm}>{t('rec.start')}</Button>
          ) : phase === 'countdown' ? (
            <Button className="w-full" size="lg" variant="outline" onClick={() => { cleanupStream(); setPhase('review') }}>{t('rec.getReady')}</Button>
          ) : phase === 'recording' ? (
            <Button className="w-full" size="lg" variant="destructive" onClick={stopRecording}>{t('rec.stop')}</Button>
          ) : phase === 'recorded' ? (
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setPhase('review')}>{t('rec.rerecord')}</Button>
              <Button className="flex-1" size="lg" onClick={submit}>{t('submit')}</Button>
            </div>
          ) : (
            <Button className="w-full" size="lg" disabled>{t('rec.uploading')}</Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
