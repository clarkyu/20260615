'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { submitRecitedText } from '@/actions/submissions'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Recorder } from './recorder'

interface Sentence {
  order: number
  text: string
}

const DONE_STATUSES = ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED']

function StepBar({ step }: { step: 1 | 2 }) {
  const items = [
    { n: 1 as const, label: '默写文本' },
    { n: 2 as const, label: '闭眼视频' },
  ]
  return (
    <div className="flex items-center justify-center gap-3 text-sm">
      {items.map((it, i) => (
        <div key={it.n} className="flex items-center gap-3">
          <span
            className={
              'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ' +
              (it.n === step ? 'bg-primary text-primary-foreground' : it.n < step ? 'bg-emerald-600 text-white' : 'bg-secondary text-muted-foreground')
            }
          >
            {it.n < step ? '✓' : it.n}
          </span>
          <span className={it.n === step ? 'font-medium' : 'text-muted-foreground'}>{it.label}</span>
          {i === 0 ? <span className="text-muted-foreground">→</span> : null}
        </div>
      ))}
    </div>
  )
}

function TextStep({
  assignmentId,
  initial,
  onDone,
}: {
  assignmentId: number
  initial: string
  onDone: () => void
}) {
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
        <CardTitle className="text-lg">第一步 · 默写背诵文本</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          凭记忆把要背诵的内容默写出来（每句一行）。提交后进入第二步录闭眼背诵视频。
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="在此默写…"
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {error ? <FormMessage>{error}</FormMessage> : null}
        <Button onClick={submit} disabled={pending || !text.trim()} className="w-full">
          {pending ? '提交中…' : '提交默写，进入第二步'}
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
          <FormMessage>{props.windowState === 'not-open' ? '作业还未开放。' : '作业已截止。'}</FormMessage>
          <Link href="/student">
            <Button variant="outline" className="w-full">返回</Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  if (completed && !redo) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{props.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <FormMessage tone="success">两步都已提交，等待老师评阅。</FormMessage>
          {props.latestScore != null ? (
            <p>
              得分：<span className="font-semibold">{props.latestScore}</span>
              {props.latestFeedback ? <span className="block text-muted-foreground">{props.latestFeedback}</span> : null}
            </p>
          ) : null}
          {props.attemptsLeft > 0 ? (
            <Button variant="outline" className="w-full" onClick={() => { setRedo(true); setStep(1) }}>
              重做（剩余 {props.attemptsLeft} 次）
            </Button>
          ) : null}
          <Link href="/student">
            <Button variant="ghost" className="w-full">返回作业列表</Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{props.title}</h1>
        <p className="text-sm text-muted-foreground">{props.sentences.length} 句 · 两步提交</p>
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
          <button
            onClick={() => setStep(1)}
            className="block w-full text-center text-sm text-muted-foreground hover:text-foreground"
          >
            ← 返回第一步，重写默写
          </button>
        </>
      )}
    </div>
  )
}
