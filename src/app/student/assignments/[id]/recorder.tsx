'use client'

import { uploadErrorText } from '@/lib/upload-error'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Eye, ListChecks, Video, Mic, Wifi } from 'lucide-react'
import { getUploadUrl, recordMedia } from '@/actions/submissions'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { RecordConsentNotice, hasRecordConsent } from '@/components/record-consent'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface Sentence {
  order: number
  text: string
}

type Mode = 'video' | 'audio'
type Phase = 'review' | 'countdown' | 'recording' | 'recorded' | 'uploading'

interface Violation {
  type: string
  at: number
}

function pickMimeType(mode: Mode): { mime: string; ext: string } {
  const video: Array<{ mime: string; ext: string }> = [
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
    { mime: 'video/mp4', ext: 'mp4' },
  ]
  const audio: Array<{ mime: string; ext: string }> = [
    { mime: 'audio/webm;codecs=opus', ext: 'webm' },
    { mime: 'audio/webm', ext: 'webm' },
    { mime: 'audio/mp4', ext: 'm4a' },
  ]
  const candidates = mode === 'audio' ? audio : video
  const MR = typeof window !== 'undefined' ? window.MediaRecorder : undefined
  for (const c of candidates) if (MR && MR.isTypeSupported(c.mime)) return c
  return { mime: '', ext: mode === 'audio' ? 'webm' : 'webm' }
}

export function Recorder(props: {
  phaseId: number
  sentences: Sentence[]
  requireEyesClosed: boolean
  attemptsLeft: number
  mode: Mode
  onDone: () => void
}) {
  const t = useT()
  const isAudio = props.mode === 'audio'
  const [phase, setPhase] = useState<Phase>('review')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [count, setCount] = useState(3)
  const [violations, setViolations] = useState<Violation[]>([])
  const [needConsent, setNeedConsent] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)
  const startedAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const playbackUrlRef = useRef<string | null>(null)
  const unmountedRef = useRef(false)

  const addViolation = useCallback((type: string) => {
    setViolations((v) => [...v, { type, at: Date.now() }])
  }, [])

  useEffect(() => {
    if (phase !== 'recording' || isAudio) return
    const onHide = () => { if (document.visibilityState === 'hidden') addViolation('visibility-hidden') }
    const onBlur = () => addViolation('window-blur')
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('blur', onBlur)
    }
  }, [phase, isAudio, addViolation])

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
    // Exit fullscreen from every teardown path (not just an explicit stop), so an
    // error/unmount/cancel mid-recording can't strand the user in fullscreen.
    if (typeof document !== 'undefined' && document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }, [])

  // On unmount: stop tracks, mark unmounted (so an in-flight getUserMedia bails),
  // and revoke the playback object URL so re-records don't leak blobs.
  useEffect(() => () => {
    unmountedRef.current = true
    cleanupStream()
    if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current)
  }, [cleanupStream])

  const beginRecord = useCallback(() => {
    const stream = streamRef.current
    if (!stream) { setPhase('review'); return }
    const { mime } = pickMimeType(props.mode)
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    chunksRef.current = []
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    recorder.onstop = () => {
      blobRef.current = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || (isAudio ? 'audio/webm' : 'video/webm') })
      setPhase('recorded')
      cleanupStream()
      if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current)
      const playbackUrl = URL.createObjectURL(blobRef.current)
      playbackUrlRef.current = playbackUrl
      if (isAudio) {
        if (audioRef.current) { audioRef.current.src = playbackUrl; audioRef.current.controls = true }
      } else if (videoRef.current) {
        videoRef.current.srcObject = null
        videoRef.current.src = playbackUrl
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
    // 全屏沉浸（防作弊）后锁定竖屏，杜绝移动端「全屏视频→自动转横屏」。Android 生效；
    // iOS 不支持 orientation.lock 会被忽略，但竖屏采集本身已避免大多数旋转。
    if (!isAudio) {
      void document.documentElement.requestFullscreen?.()
        .then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<unknown> }).lock?.('portrait'))
        .catch(() => {})
    }
  }, [props.mode, isAudio, cleanupStream])

  useEffect(() => {
    if (phase !== 'countdown') return
    if (count <= 0) { beginRecord(); return }
    const id = setTimeout(() => setCount((c) => c - 1), 850)
    return () => clearTimeout(id)
  }, [phase, count, beginRecord])

  const arm = useCallback(async () => {
    setError(null)
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(t('rec.noSupport'))
      return
    }
    // Defensively stop any prior stream before acquiring a new one (re-record).
    cleanupStream()
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        isAudio
          ? { audio: true }
          // 竖屏采集（宽<高）：手机录制保持竖向，避免录出横屏视频、也避免全屏时自动转横屏。
          : { video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 } }, audio: true },
      )
      // The component may have unmounted during the permission await — don't leak
      // the just-granted camera/mic.
      if (unmountedRef.current) { stream.getTracks().forEach((tr) => tr.stop()); return }
      streamRef.current = stream
      if (!isAudio && videoRef.current) {
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
  }, [t, isAudio, cleanupStream])

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop()
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }, [])

  const submit = useCallback(async () => {
    const blob = blobRef.current
    if (!blob) return
    setPhase('uploading')
    setError(null)
    const { ext } = pickMimeType(props.mode)
    const fileExt = blob.type.includes('mp4') ? (isAudio ? 'm4a' : 'mp4') : ext
    try {
      const res = await getUploadUrl(props.phaseId, props.mode, blob.type || (isAudio ? 'audio/webm' : 'video/webm'), fileExt)
      if ('error' in res || !res.url) {
        setError(res.error ?? 'upload failed'); setPhase('recorded'); return
      }
      const put = await fetch(res.url, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || (isAudio ? 'audio/webm' : 'video/webm') } })
      if (!put.ok) { setError(`${t('rec.uploadFail')} (${put.status})`); setPhase('recorded'); return }
      const fin = await recordMedia(res.submissionId, props.mode, blob.size, elapsed, JSON.stringify(violations))
      if ('error' in fin && fin.error) { setError(fin.error); setPhase('recorded'); return }
      props.onDone()
    } catch (e) {
      setError(uploadErrorText(e, t)); setPhase('recorded')
    }
  }, [props, elapsed, violations, t, isAudio])

  const live = phase === 'countdown' || phase === 'recording'
  const banner = props.requireEyesClosed ? t('rec.eyesBanner') : t('rec.reciteBanner')

  return (
    <div className="space-y-3">
      {needConsent ? (
        <RecordConsentNotice onAccept={() => { setNeedConsent(false); void arm() }} onCancel={() => setNeedConsent(false)} />
      ) : null}
      {phase === 'review' ? (
        <Card>
          <CardContent className="space-y-3 p-4 text-sm">
            <p className="flex items-start gap-2 text-muted-foreground">
              {isAudio ? <Mic className="mt-0.5 h-4 w-4 shrink-0" /> : <Video className="mt-0.5 h-4 w-4 shrink-0" />}
              {isAudio ? t('rec.audioReq') : t('rec.requirement', { eyes: props.requireEyesClosed ? t('rec.eyesClosed') : t('rec.recite') })}
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
            {!isAudio ? (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Wifi className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t('rec.dataTip')}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardContent className="space-y-3 p-4">
          {isAudio ? (
            <div className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-2xl bg-secondary">
              <Mic className={'h-16 w-16 ' + (phase === 'recording' ? 'animate-pulse text-red-500' : 'text-muted-foreground')} />
              {phase === 'recording' ? (
                <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-foreground/80 px-2.5 py-1 text-xs font-semibold text-background">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />{elapsed}s
                </div>
              ) : null}
              {phase === 'countdown' ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-foreground/10" aria-live="assertive">
                  <span key={count} className="animate-in-up text-7xl font-black tabular-nums">{count > 0 ? count : ''}</span>
                  <span className="text-sm font-medium opacity-80">{t('rec.getReady')}</span>
                </div>
              ) : null}
              {phase === 'recorded' ? <audio ref={audioRef} className="absolute bottom-3 left-3 right-3 w-auto" /> : null}
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-2xl bg-black">
              <video ref={videoRef} playsInline className={'aspect-[3/4] w-full object-cover ' + (live ? '-scale-x-100' : '')} />
              {phase === 'recording' ? (
                <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />{elapsed}s
                  {/* Anti-cheat 违规仍在后台记录，但不在录制中显示——闪烁的计数会让学生紧张。 */}
                </div>
              ) : null}
              {phase === 'recording' ? (
                <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-2 bg-gradient-to-b from-black/55 to-transparent py-3 text-sm font-semibold text-white">
                  {props.requireEyesClosed ? <Eye className="h-4 w-4" /> : null}{banner}
                </div>
              ) : null}
              {phase === 'countdown' ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 text-white" aria-live="assertive">
                  <span key={count} className="animate-in-up text-7xl font-black tabular-nums">{count > 0 ? count : ''}</span>
                  <span className="text-sm font-medium opacity-90">{t('rec.getReady')}</span>
                </div>
              ) : null}
              {phase === 'review' ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70">
                  <Video className="h-10 w-10" />
                  <span className="px-6 text-center text-xs">{t('rec.countHint')}</span>
                </div>
              ) : null}
            </div>
          )}

          {error ? <FormMessage>{error}</FormMessage> : null}

          {props.attemptsLeft <= 0 && phase === 'review' ? (
            <FormMessage>{t('rec.usedUp')}</FormMessage>
          ) : phase === 'review' ? (
            <Button className="w-full" size="lg" onClick={() => (hasRecordConsent() ? arm() : setNeedConsent(true))}>{isAudio ? t('rec.startAudio') : t('rec.start')}</Button>
          ) : phase === 'countdown' ? (
            <Button className="w-full" size="lg" variant="outline" onClick={() => { cleanupStream(); setPhase('review') }}>{t('rec.cancel')}</Button>
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
