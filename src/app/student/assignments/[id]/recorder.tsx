'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { getUploadUrl, finalizeSubmission } from '@/actions/submissions'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface Sentence {
  order: number
  text: string
}

type Phase = 'review' | 'recording' | 'recorded' | 'uploading' | 'done'

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

  const startRecording = useCallback(async () => {
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
        await videoRef.current.play().catch(() => {})
      }
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
    } catch {
      setError(t('rec.noPermission'))
    }
  }, [cleanupStream, t])

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
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-success/15 text-success">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <p className="text-lg font-bold">{t('rec.success')}</p>
          <p className="text-sm text-muted-foreground">{t('rec.successDesc')}</p>
          <Link href="/student" className="w-full">
            <Button className="w-full">{t('sub.backToList')}</Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-3 p-4 text-sm">
          <p className="text-muted-foreground">
            {t('rec.requirement', { eyes: props.requireEyesClosed ? t('rec.eyesClosed') : t('rec.recite') })}
          </p>
          <details>
            <summary className="cursor-pointer font-medium text-foreground">{t('rec.review', { n: props.sentences.length })}</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              {props.sentences.map((s) => <li key={s.order}>{s.text}</li>)}
            </ol>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <video ref={videoRef} playsInline className="aspect-video w-full rounded-xl bg-black" />
          {phase === 'recording' ? (
            <p className="text-center text-sm font-semibold text-destructive">
              ● {t('rec.recording')} {elapsed}s{violations.length > 0 ? ` · ⚠️ ${violations.length} ${t('rec.leftTimes')}` : ''}
            </p>
          ) : null}
          {error ? <FormMessage>{error}</FormMessage> : null}

          {props.attemptsLeft <= 0 && phase === 'review' ? (
            <FormMessage>{t('rec.usedUp')}</FormMessage>
          ) : phase === 'review' ? (
            <Button className="w-full" size="lg" onClick={startRecording}>{t('rec.start')}</Button>
          ) : phase === 'recording' ? (
            <Button className="w-full" size="lg" variant="destructive" onClick={stopRecording}>{t('rec.stop')}</Button>
          ) : phase === 'recorded' ? (
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setPhase('review')}>{t('rec.rerecord')}</Button>
              <Button className="flex-1" onClick={submit}>{t('submit')}</Button>
            </div>
          ) : (
            <Button className="w-full" disabled>{t('rec.uploading')}</Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
