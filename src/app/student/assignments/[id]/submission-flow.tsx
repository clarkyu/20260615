'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { PenLine, Video } from 'lucide-react'
import { submitRecitedText } from '@/actions/submissions'
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

const DONE_STATUSES = ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED']

function StepBar({ step }: { step: 1 | 2 }) {
  const t = useT()
  const items = [
    { n: 1 as const, label: t('sub.step1'), icon: PenLine },
    { n: 2 as const, label: t('sub.step2'), icon: Video },
  ]
  return (
    <div className="flex items-center gap-2">
      {items.map((it, i) => {
        const Icon = it.icon
        const state = it.n < step ? 'done' : it.n === step ? 'active' : 'todo'
        return (
          <div key={it.n} className="flex flex-1 items-center gap-2">
            <div
              className={
                'flex flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ' +
                (state === 'active'
                  ? 'border-primary/40 bg-accent text-accent-foreground'
                  : state === 'done'
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'border-border bg-card text-muted-foreground')
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{it.label}</span>
            </div>
            {i === 0 ? <span className="text-muted-foreground">→</span> : null}
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
          {pending ? t('sub.submitting') : t('sub.step1Submit')}
        </Button>
      </CardContent>
    </Card>
  )
}

export function SubmissionFlow(props: {
  assignmentId: number
  title: string
  sentences: Sentence[]
  requireEyesClosed: boolean
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
  const [step, setStep] = useState<1 | 2>(props.initialHasText ? 2 : 1)
  const [redo, setRedo] = useState(false)

  if (props.windowState !== 'open') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{props.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <FormMessage>{props.windowState === 'not-open' ? t('sub.notOpen') : t('sub.closed')}</FormMessage>
          <Link href="/student">
            <Button variant="outline" className="w-full">{t('back')}</Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  if (completed && !redo) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{props.title}</CardTitle>
        </CardHeader>
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
            <Button variant="outline" className="w-full" onClick={() => { setRedo(true); setStep(1) }}>
              {t('sub.redo')}（{t('sub.redoLeft', { n: props.attemptsLeft })}）
            </Button>
          ) : null}
          <Link href="/student">
            <Button variant="ghost" className="w-full">{t('sub.backToList')}</Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{props.title}</h1>
        <p className="text-sm text-muted-foreground">{props.sentences.length} {t('asg.sentences')} · {t('sub.twoStep')}</p>
      </div>
      <StepBar step={step} />

      {step === 1 ? (
        <TextStep assignmentId={props.assignmentId} initial={props.initialRecitedText} onDone={() => setStep(2)} />
      ) : (
        <>
          <Recorder
            assignmentId={props.assignmentId}
            title={props.title}
            sentences={props.sentences}
            requireEyesClosed={props.requireEyesClosed}
            attemptsLeft={props.attemptsLeft}
            latestStatus={null}
            latestScore={null}
            latestFeedback={null}
            windowState="open"
          />
          <button onClick={() => setStep(1)} className="block w-full py-1 text-center text-sm text-muted-foreground hover:text-foreground">
            {t('sub.backToStep1')}
          </button>
        </>
      )}
    </div>
  )
}
