'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PenLine, Video, Mic, Camera, Check, CheckCircle2, AlertTriangle, ArrowRight, ShieldAlert, ListChecks, MessageSquare } from 'lucide-react'
import { submitRecitedText, submitChoice, submitMultiChoice, submitFreeText, submitFillBlank, finishSubmission, getOwnSubmissionMediaUrl } from '@/actions/submissions'
import { parseChoices, sameChoiceSet } from '@/lib/choices'
import { splitBlanks } from '@/lib/fill-blank'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Recorder } from './recorder'
import { PhotoStep } from './photo-step'
import { PracticePanel } from './practice-panel'

interface Sentence {
  order: number
  text: string
}
type Kind = 'text' | 'video' | 'audio' | 'handwriting' | 'choice' | 'freetext' | 'fill'

const DONE_STATUSES = ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED']
const KIND_META: Record<Kind, { key: string; icon: typeof PenLine }> = {
  text: { key: 'sub.step1', icon: PenLine },
  video: { key: 'sub.step2', icon: Video },
  audio: { key: 'sub.stepAudio', icon: Mic },
  handwriting: { key: 'sub.stepImage', icon: Camera },
  choice: { key: 'sub.stepChoice', icon: ListChecks },
  freetext: { key: 'sub.stepFreeText', icon: MessageSquare },
  fill: { key: 'sub.stepFill', icon: PenLine },
}

// 正式测试横幅：告诉学生这是受监督的正式测试，行为更端正 = 成绩更真实。
export function FormalTestBanner() {
  const t = useT()
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
      <div>
        <p className="font-semibold text-warning">{t('sub.formalTest')}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('sub.formalTestDesc')}</p>
      </div>
    </div>
  )
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

// 文本输入步骤。默写背诵（submitRecitedText）和自由文本（submitFreeText）共用这一块，
// 只是文案与提交动作不同。
function TextStep({
  phaseId, initial, onDone,
  action = submitRecitedText,
  titleKey = 'sub.step1Title', descKey = 'sub.step1Desc', phKey = 'sub.step1Ph', submitKey = 'sub.next',
}: {
  phaseId: number
  initial: string
  onDone: () => void
  action?: (phaseId: number, text: string) => Promise<{ error?: string }>
  titleKey?: string
  descKey?: string
  phKey?: string
  submitKey?: string
}) {
  const t = useT()
  const [text, setText] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    setError(null)
    start(async () => {
      const res = await action(phaseId, text)
      if (res.error) setError(res.error)
      else onDone()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(titleKey)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t(descKey)}</p>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} placeholder={t(phKey)} aria-label={t(phKey)} />
        {error ? <FormMessage>{error}</FormMessage> : null}
        <Button onClick={submit} disabled={pending || !text.trim()} size="lg" className="w-full">
          {pending ? t('sub.submitting') : t(submitKey)}
        </Button>
      </CardContent>
    </Card>
  )
}

// 单选投票步骤：从老师配置的选项里选一个提交。无对错，纯记票。
function ChoiceStep({ phaseId, choices, initial, multiChoice, onDone }: { phaseId: number; choices: string[]; initial: string; multiChoice: boolean; onDone: () => void }) {
  const t = useT()
  const [picked, setPicked] = useState(initial) // 单选
  const [pickedSet, setPickedSet] = useState<string[]>(() => (multiChoice ? parseChoices(initial) : [])) // 多选
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    setError(null)
    start(async () => {
      const res = multiChoice ? await submitMultiChoice(phaseId, pickedSet) : await submitChoice(phaseId, picked)
      if (res.error) setError(res.error)
      else onDone()
    })
  }
  const canSubmit = multiChoice ? pickedSet.length > 0 : Boolean(picked)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sub.choiceTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{multiChoice ? t('sub.choiceMultiDesc') : t('sub.choiceDesc')}</p>
        <div className="space-y-2">
          {choices.map((opt, i) => {
            const on = multiChoice ? pickedSet.includes(opt) : picked === opt
            return (
              <label
                key={i}
                className={'flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ' + (on ? 'border-primary bg-primary/5 font-medium' : 'border-input')}
              >
                <input
                  type={multiChoice ? 'checkbox' : 'radio'}
                  name={`choice-${phaseId}`}
                  value={opt}
                  checked={on}
                  onChange={() => multiChoice
                    ? setPickedSet((s) => (s.includes(opt) ? s.filter((x) => x !== opt) : [...s, opt]))
                    : setPicked(opt)}
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                />
                <span className="whitespace-pre-wrap">{opt}</span>
              </label>
            )
          })}
        </div>
        {error ? <FormMessage>{error}</FormMessage> : null}
        <Button onClick={submit} disabled={pending || !canSubmit} size="lg" className="w-full">
          {pending ? t('sub.submitting') : t('submit')}
        </Button>
      </CardContent>
    </Card>
  )
}

// 填空题作答：题干按 ____ 切成段，段间嵌入输入框；逐空作答后 submitFillBlank。
function FillBlankStep({ phaseId, text, initial, onDone }: { phaseId: number; text: string; initial: string; onDone: () => void }) {
  const t = useT()
  const segments = splitBlanks(text)
  const n = Math.max(0, segments.length - 1)
  const [answers, setAnswers] = useState<string[]>(() => {
    const init = parseChoices(initial)
    return Array.from({ length: n }, (_, i) => init[i] ?? '')
  })
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    setError(null)
    start(async () => {
      const res = await submitFillBlank(phaseId, answers)
      if (res.error) setError(res.error)
      else onDone()
    })
  }
  const canSubmit = answers.some((a) => a.trim())

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sub.fillTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('sub.fillDesc')}</p>
        <div className="rounded-xl bg-secondary p-3 text-base leading-9">
          {segments.map((seg, i) => (
            <span key={i}>
              <span className="whitespace-pre-wrap">{seg}</span>
              {i < n ? (
                <input
                  value={answers[i]}
                  onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
                  className="mx-1 inline-block w-28 rounded-md border-b-2 border-primary bg-background px-2 py-0.5 align-middle text-sm focus:outline-none"
                  aria-label={t('asg.blankNth', { n: i + 1 })}
                />
              ) : null}
            </span>
          ))}
        </div>
        {error ? <FormMessage>{error}</FormMessage> : null}
        <Button onClick={submit} disabled={pending || !canSubmit} size="lg" className="w-full">
          {pending ? t('sub.submitting') : t('submit')}
        </Button>
      </CardContent>
    </Card>
  )
}

// 学生回看自己提交的音/视频/手写图：点按钮拉取临时链接，就地内联播放/查看。
function MySubmissionMedia({ submissionId, hasVideo, hasAudio, hasImage }: { submissionId: number; hasVideo: boolean; hasAudio: boolean; hasImage: boolean }) {
  const t = useT()
  const [media, setMedia] = useState<{ kind: 'video' | 'audio' | 'image'; url: string } | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!hasVideo && !hasAudio && !hasImage) return null

  async function open(kind: 'video' | 'audio' | 'image') {
    setError(null)
    setLoading(kind)
    const res = await getOwnSubmissionMediaUrl(submissionId, kind)
    setLoading(null)
    if (res.error) setError(res.error)
    else if (res.url) setMedia({ kind, url: res.url })
  }

  return (
    <div className="space-y-2 rounded-xl bg-secondary p-3">
      <div className="text-xs font-medium text-muted-foreground">{t('sub.mySubmission')}</div>
      <div className="flex flex-wrap gap-2">
        {hasVideo ? <Button size="sm" variant="outline" disabled={loading === 'video'} onClick={() => open('video')}><Video className="h-4 w-4" />{t('sub.viewVideo')}</Button> : null}
        {hasAudio ? <Button size="sm" variant="outline" disabled={loading === 'audio'} onClick={() => open('audio')}><Mic className="h-4 w-4" />{t('sub.viewAudio')}</Button> : null}
        {hasImage ? <Button size="sm" variant="outline" disabled={loading === 'image'} onClick={() => open('image')}><Camera className="h-4 w-4" />{t('sub.viewImage')}</Button> : null}
      </div>
      {error ? <FormMessage>{error}</FormMessage> : null}
      {media?.kind === 'video' ? <video src={media.url} controls playsInline className="w-full rounded-xl bg-black" /> : null}
      {media?.kind === 'audio' ? <audio src={media.url} controls className="w-full" /> : null}
      {media?.kind === 'image' ? <img src={media.url} alt={t('sub.mySubmission')} className="w-full rounded-xl" /> : null}
    </div>
  )
}

export function SubmissionFlow(props: {
  phaseId: number
  title: string
  category: string | null
  instructions: string | null
  shadowing?: React.ReactNode
  practice?: React.ReactNode
  sentences: Sentence[]
  requireEyesClosed: boolean
  requireText: boolean
  requireVideo: boolean
  requireAudio: boolean
  requireHandwriting: boolean
  requireChoice: boolean
  choices: string[]
  correctChoice?: string | null
  multiChoice?: boolean
  correctChoices?: string[]
  fillBlank?: boolean
  fillText?: string
  requireFreeText: boolean
  attemptsLeft: number
  windowState: 'open' | 'not-open' | 'closed'
  initialHasText: boolean
  initialRecitedText: string
  latestStatus: string | null
  latestScore: number | null
  latestFeedback: string | null
  latestPerSentence: { order: number; accuracy: number; completeness: number; spokenText?: string }[]
  latestTranscript?: string
  submissionId?: number | null
  hasVideo?: boolean
  hasAudio?: boolean
  hasImage?: boolean
  nextHref?: string | null
  nextLabel?: string | null
  isFormalTest?: boolean
}) {
  const t = useT()
  const router = useRouter()
  const completed = props.latestStatus !== null && DONE_STATUSES.includes(props.latestStatus)
  // 「已录制未提交」续交(复盘):媒体已传齐、只是最后的提交动作没成功——下次进来一键补交,
  // 不必重录。只对含音/视频的环节展示(文本类补交无成本,不必打扰)。
  const resumable =
    props.latestStatus === 'DRAFT' &&
    (props.requireVideo || props.requireAudio) &&
    (!props.requireVideo || Boolean(props.hasVideo)) &&
    (!props.requireAudio || Boolean(props.hasAudio)) &&
    (!props.requireText || props.initialHasText) &&
    (!props.requireHandwriting || Boolean(props.hasImage))
  const steps = useMemo(() => {
    const s: Kind[] = []
    if (props.requireText) s.push('text')
    if (props.requireChoice) s.push('choice')
    if (props.requireFreeText) s.push('freetext')
    if (props.fillBlank) s.push('fill')
    if (props.requireVideo) s.push('video')
    if (props.requireAudio) s.push('audio')
    if (props.requireHandwriting) s.push('handwriting')
    return s
  }, [props.requireText, props.requireChoice, props.requireFreeText, props.fillBlank, props.requireVideo, props.requireAudio, props.requireHandwriting])

  // Skip the text step when it's already submitted — but clamp so a text-only
  // assignment (steps === ['text']) can't start out of range and render a wrong
  // (recorder) branch.
  const [idx, setIdx] = useState(Math.min(steps[0] === 'text' && props.initialHasText ? 1 : 0, Math.max(0, steps.length - 1)))
  const [phase, setPhase] = useState<'doing' | 'finishing' | 'done' | 'error'>('doing')
  const [error, setError] = useState<string | null>(null)
  const [redo, setRedo] = useState(false)
  const [weakPractice, setWeakPractice] = useState(false)
  const [, startFinish] = useTransition()

  // 多环节自动衔接：刚交完（done）且还有下一环节时，短暂展示「已提交」后自动前往。
  useEffect(() => {
    if (phase !== 'done' || !props.nextHref) return
    const id = setTimeout(() => router.push(props.nextHref as string), 1800)
    return () => clearTimeout(id)
  }, [phase, props.nextHref, router])

  function finish() {
    setPhase('finishing'); setError(null)
    startFinish(async () => {
      // 最后一跳韧性(「提交成功后又显示未提交」复盘):上传各步都成了,只差这一个
      // server action——网络抖动就把提交留在 DRAFT。动作「抛异常」(网络层)自动重试
      // 2 次;动作返回 {error}(真校验失败)不重试,如实展示。
      for (let i = 0; i < 3; i++) {
        try {
          const res = await finishSubmission(props.phaseId)
          if (res.error) { setError(res.error); setPhase('error') }
          else setPhase('done')
          return
        } catch {
          if (i === 2) { setError(t('sub.finishRetryFail')); setPhase('error'); return }
          await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
        }
      }
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
          <div className="animate-pop grid h-16 w-16 place-items-center rounded-full bg-success/15 text-success"><CheckCircle2 className="h-9 w-9" /></div>
          <p className="text-xl font-bold">{t('rec.success')}</p>
          <p className="text-sm text-muted-foreground">{t('rec.successDesc')}</p>
          {props.nextHref ? (
            <>
              <p className="text-xs text-muted-foreground">{t('sub.nextAuto')}</p>
              <Link href={props.nextHref} className="mt-1 w-full">
                <Button className="w-full" size="lg">{t('sub.nextPhase')}{props.nextLabel ? `：${props.nextLabel}` : ''}<ArrowRight className="h-4 w-4" /></Button>
              </Link>
              <Link href="/student" className="w-full"><Button variant="ghost" className="w-full">{t('sub.backToList')}</Button></Link>
            </>
          ) : (
            <Link href="/student" className="mt-1 w-full"><Button className="w-full" size="lg">{t('sub.backToList')}</Button></Link>
          )}
        </CardContent>
      </Card>
    )
  }

  if (completed && !redo) {
    const byOrder = new Map(props.latestPerSentence.map((p) => [p.order, p]))
    const hasPerSentence = props.latestPerSentence.length > 0 && props.sentences.length > 0
    // 单选/多选（设了正确答案）：判断对错，便于回显对/错与揭晓答案。
    const answered = !!props.initialRecitedText
    const isMulti = props.requireChoice && !!props.multiChoice
    const choiceGraded = props.requireChoice && answered && (isMulti ? (props.correctChoices?.length ?? 0) > 0 : !!props.correctChoice)
    const choiceRight = choiceGraded && (isMulti
      ? sameChoiceSet(parseChoices(props.initialRecitedText), props.correctChoices ?? [])
      : props.initialRecitedText.trim() === (props.correctChoice as string).trim())
    // 回显文本：多选 / 填空作答都是 JSON 数组，按语言的列表分隔符展开；单选/自由文本原样。
    const answerText = (isMulti || props.fillBlank) ? parseChoices(props.initialRecitedText).join(t('sep.list')) : props.initialRecitedText
    const correctText = isMulti ? (props.correctChoices ?? []).join(t('sep.list')) : (props.correctChoice ?? '')
    // The lines the AI marked weak — so the student can drill just those (零压力练习).
    const weakSentences = props.sentences.filter((s) => {
      const p = byOrder.get(s.order)
      return p ? p.accuracy < 0.6 || p.completeness < 0.6 : false
    })
    return (
      <Card>
        <CardHeader><CardTitle>{props.title}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <FormMessage tone="success">
            {props.sentences.length === 0 && props.requireChoice
              ? t('sub.pollDone')
              : props.sentences.length === 0 && props.requireFreeText
                ? t('sub.reviewPending')
                : t('sub.bothDone')}
          </FormMessage>
          {/* 单选/多选投票 / 自由文本：把学生提交的答案回显出来。 */}
          {props.sentences.length === 0 && props.initialRecitedText ? (
            <div className="rounded-xl bg-secondary p-3">
              <div className="text-xs font-medium text-muted-foreground">{t('sub.yourAnswer')}</div>
              <p className="mt-1 whitespace-pre-wrap">{answerText}</p>
            </div>
          ) : null}
          {/* 单选/多选题：显示对/错；答错且非正式测试时揭晓正确答案。 */}
          {choiceGraded ? (
            <div className={'rounded-xl p-3 ' + (choiceRight ? 'bg-success/10' : 'bg-destructive/10')}>
              <p className={'flex items-center gap-1.5 font-medium ' + (choiceRight ? 'text-success' : 'text-destructive')}>
                {choiceRight ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {choiceRight ? t('sub.correct') : t('sub.wrong')}
              </p>
              {!choiceRight && !props.isFormalTest ? (
                <p className="mt-1 text-xs text-muted-foreground">{t('sub.correctAnswer')}{correctText}</p>
              ) : null}
            </div>
          ) : null}
          {props.latestScore != null ? (
            <div className="rounded-xl bg-secondary p-3">
              <span className="text-muted-foreground">{t('sub.score')}: </span>
              <span className="text-lg font-bold">{props.latestScore}</span>
              {props.latestFeedback ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{props.latestFeedback}</p> : null}
            </div>
          ) : null}
          {props.submissionId ? (
            <MySubmissionMedia submissionId={props.submissionId} hasVideo={!!props.hasVideo} hasAudio={!!props.hasAudio} hasImage={!!props.hasImage} />
          ) : null}
          {hasPerSentence ? (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">{t('sub.perSentence')}</div>
              <ul className="space-y-1.5">
                {props.sentences.map((s) => {
                  const p = byOrder.get(s.order)
                  const weak = p ? p.accuracy < 0.6 || p.completeness < 0.6 : false
                  return (
                    <li key={s.order} className="space-y-0.5">
                      <div className="flex items-start gap-2">
                        {weak
                          ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                          : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />}
                        <span className={weak ? 'text-foreground' : 'text-muted-foreground'}>{s.text}</span>
                      </div>
                      {weak && p?.spokenText ? <div className="pl-6 text-xs text-muted-foreground">{t('sub.youSaid')}{p.spokenText}</div> : null}
                    </li>
                  )
                })}
              </ul>
              <p className="text-xs text-muted-foreground">{t('sub.perSentenceHint')}</p>
              {weakSentences.length > 0 ? (
                weakPractice ? (
                  <PracticePanel phaseId={props.phaseId} sentences={weakSentences} />
                ) : (
                  <Button variant="outline" className="w-full" onClick={() => setWeakPractice(true)}>
                    <Mic className="h-4 w-4" />{t('sub.practiceWeak', { n: weakSentences.length })}
                  </Button>
                )
              ) : null}
              {props.latestTranscript ? (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">{t('sub.transcript')}</summary>
                  <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-secondary p-2 font-sans">{props.latestTranscript}</pre>
                </details>
              ) : null}
            </div>
          ) : null}
          {props.attemptsLeft > 0 ? (
            <Button variant="outline" className="w-full" onClick={() => { setRedo(true); setIdx(0); setPhase('doing') }}>
              {t('sub.redo')}（{t('sub.redoLeft', { n: props.attemptsLeft })}）
            </Button>
          ) : null}
          {props.nextHref ? (
            <Link href={props.nextHref}><Button className="w-full" size="lg">{t('sub.nextPhase')}{props.nextLabel ? `：${props.nextLabel}` : ''}<ArrowRight className="h-4 w-4" /></Button></Link>
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
        {props.category ? <Badge tone="primary" className="mb-1">{props.category}</Badge> : null}
        <h1 className="text-xl font-bold tracking-tight">{props.title}</h1>
        {props.instructions ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{props.instructions}</p> : null}
      </div>
      {props.isFormalTest ? <FormalTestBanner /> : null}
      {resumable && phase === 'doing' ? (
        <Card className="border-primary/40">
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-medium">{t('sub.resumeTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('sub.resumeDesc')}</p>
            <Button className="w-full" onClick={finish}>{t('sub.resumeCta')}</Button>
          </CardContent>
        </Card>
      ) : null}
      {props.shadowing}
      {props.practice}
      <Steps steps={steps} idx={idx} />

      {phase === 'finishing' ? (
        <Card><CardContent role="status" aria-live="polite" className="py-8 text-center text-sm text-muted-foreground">{t('sub.submitting')}</CardContent></Card>
      ) : phase === 'error' ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {error ? <FormMessage>{error}</FormMessage> : null}
            <Button className="w-full" onClick={finish}>{t('submit')}</Button>
          </CardContent>
        </Card>
      ) : current === 'text' ? (
        <TextStep phaseId={props.phaseId} initial={props.initialRecitedText} onDone={advance} />
      ) : current === 'choice' ? (
        <ChoiceStep phaseId={props.phaseId} choices={props.choices} initial={props.initialRecitedText} multiChoice={Boolean(props.multiChoice)} onDone={advance} />
      ) : current === 'freetext' ? (
        <TextStep
          phaseId={props.phaseId}
          initial={props.initialRecitedText}
          onDone={advance}
          action={submitFreeText}
          titleKey="sub.freeTextTitle"
          descKey="sub.freeTextDesc"
          phKey="sub.freeTextPh"
          submitKey="submit"
        />
      ) : current === 'fill' ? (
        <FillBlankStep phaseId={props.phaseId} text={props.fillText ?? ''} initial={props.initialRecitedText} onDone={advance} />
      ) : current === 'handwriting' ? (
        <PhotoStep phaseId={props.phaseId} onDone={advance} />
      ) : (
        <Recorder
          phaseId={props.phaseId}
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
