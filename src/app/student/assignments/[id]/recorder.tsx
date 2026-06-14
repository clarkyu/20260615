'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { getUploadUrl, finalizeSubmission } from '@/actions/submissions'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
  for (const c of candidates) {
    if (MR && MR.isTypeSupported(c.mime)) return c
  }
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

  // While recording, leaving the page/app counts as a violation.
  useEffect(() => {
    if (phase !== 'recording') return
    const onHide = () => {
      if (document.visibilityState === 'hidden') addViolation('visibility-hidden')
    }
    const onBlur = () => addViolation('window-blur')
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('blur', onBlur)
    }
  }, [phase, addViolation])

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  useEffect(() => () => cleanupStream(), [cleanupStream])

  const startRecording = useCallback(async () => {
    setError(null)
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('当前浏览器不支持摄像头录制，请用较新版本的 Chrome / Safari。')
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
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
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
      // Best-effort fullscreen to discourage leaving the app.
      document.documentElement.requestFullscreen?.().catch(() => {})
    } catch {
      setError('无法访问摄像头/麦克风。请在浏览器中允许权限后重试。')
    }
  }, [cleanupStream])

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
        setError(res.error ?? '获取上传地址失败')
        setPhase('recorded')
        return
      }
      const put = await fetch(res.url, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'video/webm' } })
      if (!put.ok) {
        setError('上传失败，请检查网络后重试。')
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
      setError('提交出错，请重试。')
      setPhase('recorded')
    }
  }, [props.assignmentId, elapsed, violations])

  if (props.windowState !== 'open') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{props.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <FormMessage>{props.windowState === 'not-open' ? '作业还未开放。' : '作业已截止。'}</FormMessage>
          <Link href="/student">
            <Button variant="outline" className="w-full">返回</Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  if (phase === 'done') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>提交成功 ✅</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">老师评阅后即可在作业列表查看成绩。</p>
          <Link href="/student">
            <Button className="w-full">返回作业列表</Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{props.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {props.latestStatus && props.latestStatus !== 'DRAFT' ? (
            <p className="text-muted-foreground">
              当前状态：已提交。{props.latestScore != null ? `得分 ${props.latestScore}。` : ''} 剩余可提交次数：{props.attemptsLeft}。
            </p>
          ) : null}
          <p className="text-muted-foreground">
            要求：{props.requireEyesClosed ? '闭眼背诵' : '背诵'}、一镜到底、全程不要离开本页面。录制过程中切到其他应用会被记为违规。
          </p>
          <details>
            <summary className="cursor-pointer font-medium">先复习要背的 {props.sentences.length} 句（录制时请收起）</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              {props.sentences.map((s) => (
                <li key={s.order}>{s.text}</li>
              ))}
            </ol>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <video ref={videoRef} playsInline className="aspect-video w-full rounded-md bg-black" />
          {phase === 'recording' ? (
            <p className="text-center text-sm font-medium text-red-500">● 录制中 {elapsed}s{violations.length > 0 ? ` · ⚠️ ${violations.length} 次离开` : ''}</p>
          ) : null}

          {error ? <FormMessage>{error}</FormMessage> : null}

          {props.attemptsLeft <= 0 && phase === 'review' ? (
            <FormMessage>提交次数已用完。</FormMessage>
          ) : phase === 'review' ? (
            <Button className="w-full" onClick={startRecording}>开始录制</Button>
          ) : phase === 'recording' ? (
            <Button className="w-full" variant="destructive" onClick={stopRecording}>停止录制</Button>
          ) : phase === 'recorded' ? (
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setPhase('review')}>重录</Button>
              <Button className="flex-1" onClick={submit}>提交</Button>
            </div>
          ) : (
            <Button className="w-full" disabled>上传中…</Button>
          )}
        </CardContent>
      </Card>

      <Link href="/student" className="block text-center text-sm text-muted-foreground hover:text-foreground">
        返回作业列表
      </Link>
    </div>
  )
}
