'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { PenLine, Video, Mic, Check, CheckCircle2 } from 'lucide-react'
import { submitRecitedText, finishSubmission } from '@/actions/submissions'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Recorder } from './recorder'

interface Sentence {
  order: number
  text: string
}
type Kind = 'text' | 'video' | 'audio'

const DONE_STATUSES = ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED']
const KIND_META: Record<Kind, { key: string; icon: typeof PenLine }> = {
  text: { key: 'sub.step1', icon: PenLine },
  video: { key: 'sub.step2', icon: Video },
  audio: { key: 'sub.stepAudio', icon: Mic },
}

function Steps({ steps, idx }: { steps: Kind[]; idx: number }) {
  const t = useT()
  if (steps.length < 2) return null
  return (
    <div className="flex items-center">
      {steps.map((k, i) => {
        const Icon = KIND_META[k].icon
        const state = i < idx ? 'done' : i === idx ? 'active' : 'todo'
        return (
          <div key={k} className="flex flex-1 items-center">
            <div className="flex items-center gap-2">
              <div className={'grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ' + (state === 'active' ? 'bg-primary text-primary-foreground' : state === 'done' ? 'bg-success text-white' : 'bg-secondary text-muted-foreground')}>
                {state === 'done' ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <span className={'text-sm font-medium ' + (state === 'todo' ? 'text-muted-foreground' : 'text-foreground')}>{t(KIND_META[k].key)}</span>
            </div>
            {i < steps.length - 1 ? <div className={'mx-2 h-0.5 flex-1 rounded ' + (i < idx ? 'bg-success' : 'bg-border')} /> : null}
          </div>
        )
      })}
    </div>
  )
}

function TextStep({ assignmentId, initial, onDone }: { assignmentId: number; initial: string; onDone: () => void }) {
  const t = useT()
  const [text, setText] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    setError(null)
    start(async () => {
      const res = await submitRecitedText(assignmentId, text)
      if (res.error) setError(res.error)
      else onDone()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sub.step1Title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('sub.step1Desc')}</p>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} placeholder={t('sub.step1Ph')} />
        {error ? <FormMessage>{error}</FormMessage> : null}
        <Button onClick={submit} disabled={pending || !text.trim()} size="lg" className="w-full">
          {pending ? t('sub.submitting') : t('sub.next')}
        </Button>
      </CardContent>
    </Card>
  )
}

export function SubmissionFlow(props: {
  assignmentId: number
  title: string
  instructions: string | null
  sentences: Sentence[]
  requireEyesClosed: boolean
  requireText: boolean
  requireVideo: boolean
  requireAudio: boolean
  attemptsLeft: number
  windowState: 'open' | 'not-open' | 'closed'
  initialHasText: boolean
  initialRecitedText: string
  latestStatus: string | null
  latestScore: number | null
  latestFeedback: string | null
}) {
  const t = useT()
  const completed = props.latestStatus !== null && DONE_STATUSES.includes(props.latestStatus)
  const steps = useMemo(() => {
    const s: Kind[] = []
    if (props.requireText) s.push('text')
    if (props.requireVideo) s.push('video')
    if (props.requireAudio) s.push('audio')
    return s
  }, [props.requireText, props.requireVideo, props.requireAudio])

  const [idx, setIdx] = useState(steps[0] === 'text' && props.initialHasText ? 1 : 0)
  const [phase, setPhase] = useState<'doing' | 'finishing' | 'done' | 'error'>('doing')
  const [error, setError] = useState<string | null>(null)
  const [redo, setRedo] = useState(false)
  const [, startFinish] = useTransition()

  function finish() {
    setPhase('finishing'); setError(null)
    startFinish(async () => {
      const res = await finishSubmission(props.assignmentId)
      if (res.error) { setError(res.error); setPhase('error') }
      else setPhase('done')
    })
  }
  function advance() {
    const next = idx + 1
    if (next >= steps.length) finish()
    else setIdx(next)
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
          <div className="animate-in-up grid h-16 w-16 place-items-center rounded-full bg-success/15 text-success"><CheckCircle2 className="h-9 w-9" /></div>
          <p className="text-xl font-bold">{t('rec.success')}</p>
          <p className="text-sm text-muted-foreground">{t('rec.successDesc')}</p>
          <Link href="/student" className="mt-1 w-full"><Button className="w-full" size="lg">{t('sub.backToList')}</Button></Link>
        </CardContent>
      </Card>
    )
  }

  if (completed && !redo) {
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
            <Button variant="outline" className="w-full" onClick={() => { setRedo(true); setIdx(0); setPhase('doing') }}>
              {t('sub.redo')}（{t('sub.redoLeft', { n: props.attemptsLeft })}）
            </Button>
          ) : null}
          <Link href="/student"><Button variant="ghost" className="w-full">{t('sub.backToList')}</Button></Link>
        </CardContent>
      </Card>
    )
  }

  const current = steps[idx]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{props.title}</h1>
        {props.instructions ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{props.instructions}</p> : null}
      </div>
      <Steps steps={steps} idx={idx} />

      {phase === 'finishing' ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{t('sub.submitting')}</CardContent></Card>
      ) : phase === 'error' ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {error ? <FormMessage>{error}</FormMessage> : null}
            <Button className="w-full" onClick={finish}>{t('submit')}</Button>
          </CardContent>
        </Card>
      ) : current === 'text' ? (
        <TextStep assignmentId={props.assignmentId} initial={props.initialRecitedText} onDone={advance} />
      ) : (
        <Recorder
          assignmentId={props.assignmentId}
          sentences={props.sentences}
          requireEyesClosed={props.requireEyesClosed}
          attemptsLeft={props.attemptsLeft}
          mode={current === 'audio' ? 'audio' : 'video'}
          onDone={advance}
        />
      )}
    </div>
  )
}
