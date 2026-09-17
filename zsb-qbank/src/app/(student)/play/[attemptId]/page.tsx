'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { FillGroup } from '@/components/items/FillGroup'
import { ReorderItem } from '@/components/items/ReorderItem'
import { ShortAnswerGroup } from '@/components/items/ShortAnswerGroup'
import { TranslateC2EItem } from '@/components/items/TranslateC2EItem'
import { WritingItem } from '@/components/items/WritingItem'
import { AnswerSheet, type SheetSection } from '@/components/play/AnswerSheet'
import type { PlayGroup, PlayPaper, PlaySection } from '@/lib/play/types'
import { useAttemptStore, flushNow, pendingCount, setClockOffset, type GradedFeedback } from '@/lib/sync/attempt-store'
import { warmShell } from '@/lib/offline/warm-shell'
import type { StudentAnswer } from '@/lib/schema/paper'

// 作答编排页(SPEC §7):顶栏(大题名 + 进度 + 同步状态 + 答题卡)、
// 内容区按题组类型分派渲染器、底栏(上一组/提交本组/下一组)。
// 数据来自 GET /api/attempts/:id(答案已在服务端剥离,硬约束 1)。

interface AttemptPayload {
  attempt: { id: string; mode: string; status: string; deadlineAt: string | null }
  serverNow: string
  paper: PlayPaper
  responses: { itemId: string; answer: unknown; clientUpdatedAt: string }[]
}

function isAnswered(a: StudentAnswer | undefined): boolean {
  if (!a) return false
  if (a.type === 'text') return a.value.trim() !== ''
  if (a.type === 'sequence') return a.chunkIndexes.length > 0
  return a.keys.length > 0
}

// check / feedback 接口返回 → 反馈卡数据(缺字段回退安全默认值)。
function toFeedbackRow(r: Record<string, unknown>, scoreById: Map<string, number>): GradedFeedback & { itemId: string } {
  const itemId = String(r.itemId ?? '')
  const verdict = String(r.verdict ?? 'wrong')
  const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return {
    itemId,
    verdict,
    score: typeof r.score === 'number' ? r.score : 0,
    fullScore: typeof r.fullScore === 'number' ? r.fullScore : (scoreById.get(itemId) ?? 0),
    accepted: strList(r.accepted),
    // 等待中的行不把接口 message 当解析显示;error 行的 message 才是给学生看的说明。
    explanation: typeof r.explanation === 'string' ? r.explanation : verdict === 'error' && typeof r.message === 'string' ? r.message : null,
    feedback: typeof r.feedback === 'string' ? r.feedback : null,
    commonMistakes: strList(r.commonMistakes),
  }
}

const SYNC_LABEL = { synced: '已保存', pending: '保存中', offline: '离线，已存本机' } as const
const SYNC_DOT = { synced: 'bg-emerald-500', pending: 'bg-amber-500', offline: 'bg-red-500' } as const

// 考试倒计时(硬约束 6):deadline 来自服务端,本地时钟用 offset 校正后只做显示;
// 剩 5 分钟回调一次(顶栏变色 + 提醒),到 0 回调一次(自动交卷)。
function ExamCountdown({
  deadlineMs,
  offsetMs,
  onDanger,
  onExpire,
}: {
  deadlineMs: number
  offsetMs: number
  onDanger: () => void
  onExpire: () => void
}) {
  const [remain, setRemain] = useState(() => Math.max(0, deadlineMs - (Date.now() + offsetMs)))
  const warned = useRef(false)
  const expired = useRef(false)
  useEffect(() => {
    const tick = () => {
      const r = Math.max(0, deadlineMs - (Date.now() + offsetMs))
      setRemain(r)
      if (r <= 5 * 60_000 && !warned.current) {
        warned.current = true
        onDanger()
      }
      if (r <= 0 && !expired.current) {
        expired.current = true
        onExpire()
      }
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [deadlineMs, offsetMs, onDanger, onExpire])
  const total = Math.floor(remain / 1000)
  const h = Math.floor(total / 3600)
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return (
    <span
      className={`rounded-lg px-2 py-1 font-mono text-sm font-semibold ${
        remain <= 5 * 60_000 ? 'bg-red-50 text-red-600 dark:bg-red-950' : 'bg-neutral-100 dark:bg-neutral-900'
      }`}
    >
      {h > 0 ? `${h}:` : ''}
      {mm}:{ss}
    </span>
  )
}

function GroupView({ group }: { group: PlayGroup }) {
  if (group.kind === 'cloze' || group.kind === 'reading_fill') return <FillGroup group={group} />
  if (group.kind === 'reading_qa') return <ShortAnswerGroup group={group} />
  // standalone:按小题类型分派。
  const first = group.items[0]
  if (!first) return null
  if (first.type === 'reorder' || first.type === 'translate_c2e_fill') {
    return (
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 pb-10">
        {group.items.map((it) =>
          it.type === 'reorder' ? <ReorderItem key={it.id} item={it} /> : <TranslateC2EItem key={it.id} item={it} />,
        )}
      </div>
    )
  }
  if (first.type === 'writing') return <WritingItem item={first} />
  return <ShortAnswerGroup group={group} /> // short_answer / translate_e2c(无原文时单列)
}

export default function PlayPage() {
  const { attemptId } = useParams<{ attemptId: string }>()
  const router = useRouter()
  const { answers, syncState, conflict, applyGraded, touchItem } = useAttemptStore()

  const [paper, setPaper] = useState<PlayPaper | null>(null)
  const [meta, setMeta] = useState<{ mode: string; deadlineAt: string | null } | null>(null)
  const clockOffset = useRef(0) // serverNow − Date.now(),倒计时显示用
  const [error, setError] = useState<string | null>(null)
  const [groupIndex, setGroupIndex] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const [timeWarning, setTimeWarning] = useState(false)
  const [submitState, setSubmitState] = useState<'idle' | 'confirm' | 'busy' | 'failed' | 'unsynced'>('idle')
  const [unsynced, setUnsynced] = useState(0)
  const [checkError, setCheckError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(`/api/attempts/${attemptId}`)
        if (!alive) return
        if (res.status === 401) {
          setError('请先登录再作答')
          return
        }
        if (!res.ok) {
          setError('没有找到这份作答，回首页重新开始吧')
          return
        }
        const data = (await res.json()) as AttemptPayload
        if (data.attempt.status !== 'in_progress') {
          router.replace(`/result/${attemptId}`) // 已交卷:直接看成绩
          return
        }
        clockOffset.current = Date.parse(data.serverNow) - Date.now()
        await useAttemptStore.getState().init(attemptId, data.responses, data.serverNow)
        if (!alive) return
        setMeta({ mode: data.attempt.mode, deadlineAt: data.attempt.deadlineAt })
        setPaper(data.paper)
      } catch {
        if (alive) setError('加载失败，检查一下网络再试')
      }
    })()
    return () => {
      alive = false
    }
  }, [attemptId, router])

  // 预热应用壳:从首页点进来是客户端跳转,SW 没见过这一页的文档请求;
  // 不预热的话,断网后刷新就打不开这一页(作答其实还在本地)。
  useEffect(() => {
    warmShell()
  }, [])

  // 回到前台时用服务端时间重新校准倒计时(SPEC §7.7:iOS 微信切后台会冻结定时器;
  // 硬约束 6:计时以服务端 deadline_at 为准,客户端只显示)。
  useEffect(() => {
    if (meta?.mode !== 'exam') return
    let alive = true
    const resync = () => {
      if (document.visibilityState !== 'visible') return
      void (async () => {
        try {
          const res = await fetch('/api/time', { cache: 'no-store' })
          if (!res.ok || !alive) return
          const { serverNow } = (await res.json()) as { serverNow: string }
          if (alive) {
            clockOffset.current = Date.parse(serverNow) - Date.now()
            setClockOffset(serverNow) // 作答时间戳与倒计时用同一个偏移
          }
        } catch {
          // 拿不到就沿用上一次偏移;逾期仍有服务端惰性交卷兜底
        }
      })()
    }
    document.addEventListener('visibilitychange', resync)
    window.addEventListener('pageshow', resync)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', resync)
      window.removeEventListener('pageshow', resync)
    }
  }, [meta?.mode])

  // 交卷(手动确认 / 到时自动):先把同步队列冲干净再提交;失败保留本地数据供重试。
  // 队列没冲干净就**不能交** —— 交卷后保存接口对已交的 attempt 一律 409,卡在手机上的
  // 那几题再也传不上去,会按没答判 0 分(硬约束 7;弱网预演实测)。
  // 到点自动交卷是例外:那时服务端本来就过了宽限期不再收保存,拦着只会把学生困在死页面上。
  const submitExam = useCallback(
    async (opts?: { force?: boolean }) => {
      setSubmitState('busy')
      try {
        // 服务端已经不收这份作答的保存了(在别的设备上交了 / 过了宽限期):
        // 这时候说「还有几题没传上去,等网络好点再重试」是假话,重试一万次也没用。
        if (useAttemptStore.getState().conflict === 'submitted') {
          router.replace(`/result/${attemptId}`)
          return
        }
        const drained = await flushNow()
        if (!drained && !opts?.force) {
          setUnsynced(await pendingCount(attemptId))
          setSubmitState('unsynced')
          return
        }
        const res = await fetch(`/api/attempts/${attemptId}/submit`, { method: 'POST' })
        if (!res.ok) throw new Error(String(res.status))
        router.replace(`/result/${attemptId}`)
      } catch {
        setSubmitState('failed')
      }
    },
    [attemptId, router],
  )

  const flat = useMemo(
    () => (paper ? paper.sections.flatMap((s) => s.groups.map((g) => ({ section: s, group: g }))) : []),
    [paper],
  )
  const current: { section: PlaySection; group: PlayGroup } | undefined = flat[groupIndex]

  // 逐题计时(SPEC §8 中位用时):进到某一组就从这组第一题开始计;
  // 多空的题组由 FillGroup 在切空位时再细化到具体某一空。
  const firstItemId = current?.group.items[0]?.id
  useEffect(() => {
    if (firstItemId) touchItem(firstItemId)
  }, [firstItemId, touchItem])

  const sheetSections: SheetSection[] = useMemo(() => {
    if (!paper) return []
    let gi = 0
    return paper.sections.map((s) => {
      const rows: SheetSection['items'] = []
      for (const g of s.groups) {
        for (const it of g.items) {
          rows.push({ itemId: it.id, number: it.number, answered: isAnswered(answers[it.id]), groupIndex: gi })
        }
        gi += 1
      }
      return { title: s.title, items: rows }
    })
  }, [paper, answers])

  const answeredCount = useMemo(
    () => flat.reduce((n, { group }) => n + group.items.filter((it) => isAnswered(answers[it.id])).length, 0),
    [flat, answers],
  )
  const totalCount = useMemo(() => flat.reduce((n, { group }) => n + group.items.length, 0), [flat])

  // 轮询 AI 评分结果(§7.5:每 3 秒、最长 90 秒)。每次「对答案」各起一轮、互不打断
  // (换组再对答案不会让上一组永远停在「AI 评分中」);页面卸载时统一停止;写回 store 前
  // 核对 attemptId 未变(模块级 store 在同试卷新开一次练习时不会被旧轮询污染)。
  const pollTokens = useRef(new Set<{ stop: boolean }>())
  useEffect(() => {
    const tokens = pollTokens.current
    return () => {
      for (const t of tokens) t.stop = true
      tokens.clear()
    }
  }, [])
  const pollFeedback = useCallback(
    async (ids: string[], scoreById: Map<string, number>) => {
      const token = { stop: false }
      pollTokens.current.add(token)
      const sameAttempt = () => useAttemptStore.getState().attemptId === attemptId
      let remaining = [...ids]
      const deadline = Date.now() + 90_000
      try {
        while (remaining.length > 0 && Date.now() < deadline && !token.stop) {
          await new Promise((r) => setTimeout(r, 3000))
          if (token.stop || !sameAttempt()) return
          try {
            const res = await fetch(`/api/attempts/${attemptId}/feedback?itemIds=${remaining.join(',')}`)
            if (res.status === 401 || res.status === 403 || res.status === 404) return
            if (!res.ok) continue
            const json = (await res.json()) as { results?: Array<Record<string, unknown>> }
            const done = (json.results ?? []).filter((r) => r.done === true)
            if (done.length > 0 && sameAttempt()) {
              applyGraded(done.map((r) => toFeedbackRow(r, scoreById)))
              const doneIds = new Set(done.map((r) => String(r.itemId)))
              remaining = remaining.filter((id) => !doneIds.has(id))
            }
          } catch {
            // 网络抖动:下一轮再试
          }
        }
        if (remaining.length > 0 && !token.stop && sameAttempt()) {
          applyGraded(
            remaining.map((itemId) => ({ itemId, verdict: 'pending_timeout', score: 0, fullScore: scoreById.get(itemId) ?? 0, accepted: [], explanation: null })),
          )
        }
      } finally {
        pollTokens.current.delete(token)
      }
    },
    [attemptId, applyGraded],
  )

  const checkGroup = useCallback(async () => {
    if (!current || checking) return
    setChecking(true)
    try {
      // 先冲同步队列,保证服务端拿到最新作答再判(§7.6)。没冲干净就别判:
      // 判的会是服务端那份旧底稿,把刚写过的题报成「没答」,白挨一次打击。
      if (!(await flushNow())) {
        setCheckError('刚写的还没传上去，等网络好一点再对答案。')
        return
      }
      setCheckError(null)
      const scoreById = new Map(current.group.items.map((it) => [it.id, it.score]))
      const res = await fetch(`/api/attempts/${attemptId}/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemIds: current.group.items.map((it) => it.id) }),
      })
      if (!res.ok) return
      const json = (await res.json()) as { results?: Array<Record<string, unknown>> }
      const rows = (json.results ?? []).map((r) => toFeedbackRow(r, scoreById))
      applyGraded(rows)
      // 主观题 / 汉译英兜底在 AI 评分中:每 3 秒轮询,最长 90 秒(§7.5)。
      const pendingIds = rows.filter((r) => r.verdict === 'pending').map((r) => r.itemId)
      if (pendingIds.length > 0) void pollFeedback(pendingIds, scoreById)
    } catch {
      // 网络失败不打断作答;下次点「对答案」重试。
    } finally {
      setChecking(false)
    }
  }, [attemptId, current, checking, applyGraded, pollFeedback])

  const numberById = useMemo(
    () => new Map(flat.flatMap(({ group }) => group.items.map((it) => [it.id, it.number] as const))),
    [flat],
  )
  const jump = useCallback(
    (gi: number, itemId: string) => {
      setGroupIndex(gi)
      // fill 题组:把对应空位芯片滚进视野(其余题组跳到组首即可)。
      const n = numberById.get(itemId)
      setTimeout(() => {
        if (n !== undefined) {
          document.querySelector(`[data-blank="${n}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
      }, 80)
    },
    [numberById],
  )

  if (error) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-lg font-medium">{error}</p>
        <Link href="/" className="flex min-h-11 items-center rounded-xl bg-blue-600 px-5 font-medium text-white">
          回首页
        </Link>
      </main>
    )
  }
  if (!paper || !current) {
    return (
      <main className="flex flex-1 items-center justify-center text-neutral-400">
        <p>试卷加载中…</p>
      </main>
    )
  }

  const isFill = current.group.kind === 'cloze' || current.group.kind === 'reading_fill'

  return (
    // overscroll-behavior: none —— 考试页禁下拉刷新(SPEC §7.7)
    <div className="flex h-dvh flex-col overflow-hidden overscroll-none">
      <header className="shrink-0 border-b border-neutral-200 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+8px)] dark:border-neutral-800">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{current.section.title}</p>
            <p className="text-xs text-neutral-500">
              第 {groupIndex + 1}/{flat.length} 组 · 已答 {answeredCount}/{totalCount}
              <span className={`mx-1.5 inline-block h-2 w-2 rounded-full align-middle ${SYNC_DOT[syncState]}`} />
              {SYNC_LABEL[syncState]}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {meta?.mode === 'exam' && meta.deadlineAt ? (
              <ExamCountdown
                deadlineMs={Date.parse(meta.deadlineAt)}
                offsetMs={clockOffset.current}
                onDanger={() => setTimeWarning(true)}
                onExpire={() => void submitExam({ force: true })}
              />
            ) : null}
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="min-h-11 rounded-xl border border-neutral-300 px-3 text-sm font-medium dark:border-neutral-700"
            >
              答题卡
            </button>
          </div>
        </div>
        {timeWarning ? (
          <button
            type="button"
            onClick={() => setTimeWarning(false)}
            className="mt-1 w-full rounded-lg bg-red-50 px-2 py-1.5 text-left text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            还剩不到 5 分钟,到时会自动交卷。点一下关闭提醒。
          </button>
        ) : null}
        {conflict ? (
          <Link
            href={`/result/${attemptId}`}
            className="mt-1 block w-full rounded-lg bg-amber-50 px-2 py-1.5 text-left text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            {conflict === 'submitted'
              ? '这份卷已经交过了（可能是在你的另一台手机上）。这里再写就不算数了，点这里去看成绩。'
              : '考试已经结束了，答案以交卷时为准。点这里去看成绩。'}
          </Link>
        ) : null}
        {checkError ? (
          <button
            type="button"
            onClick={() => setCheckError(null)}
            className="mt-1 w-full rounded-lg bg-amber-50 px-2 py-1.5 text-left text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            {checkError}点一下关闭。
          </button>
        ) : null}
        {current.section.instructions ? (
          <p className="mt-1 line-clamp-2 text-xs text-neutral-400">{current.section.instructions}</p>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col" key={current.group.id}>
        <GroupView group={current.group} />
      </div>

      {/* fill 题组时底部让位给固定作答条(约 72px),导航条浮在其上方。 */}
      <footer
        className={`shrink-0 border-t border-neutral-200 dark:border-neutral-800 ${
          isFill ? 'mb-[72px]' : 'pb-[env(safe-area-inset-bottom)]'
        }`}
      >
        <div className="flex items-center gap-2 px-4 py-2">
          <button
            type="button"
            disabled={groupIndex === 0}
            onClick={() => setGroupIndex((i) => Math.max(0, i - 1))}
            className="min-h-11 rounded-xl border border-neutral-300 px-3 text-sm disabled:opacity-40 dark:border-neutral-700"
          >
            上一组
          </button>
          {meta?.mode === 'exam' ? (
            <button
              type="button"
              disabled={submitState === 'busy'}
              onClick={() => setSubmitState('confirm')}
              className="min-h-11 flex-1 rounded-xl bg-blue-600 px-4 font-medium text-white disabled:opacity-60"
            >
              交卷
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={checking}
                onClick={() => void checkGroup()}
                className="min-h-11 flex-1 rounded-xl bg-blue-600 px-4 font-medium text-white disabled:opacity-60"
              >
                {checking ? '对答案中…' : '对答案'}
              </button>
              {/* 练习也要有「做完了」:交卷后老师端名单 / 学情才有这份成绩,自己也能看成绩页;之后还能再练。 */}
              {groupIndex >= flat.length - 1 ? (
                <button
                  type="button"
                  disabled={submitState === 'busy'}
                  onClick={() => setSubmitState('confirm')}
                  className="min-h-11 rounded-xl border border-blue-600 px-3 text-sm font-medium text-blue-700 disabled:opacity-60 dark:text-blue-300"
                >
                  完成
                </button>
              ) : null}
            </>
          )}
          <button
            type="button"
            disabled={groupIndex >= flat.length - 1}
            onClick={() => setGroupIndex((i) => Math.min(flat.length - 1, i + 1))}
            className="min-h-11 rounded-xl border border-neutral-300 px-3 text-sm disabled:opacity-40 dark:border-neutral-700"
          >
            下一组
          </button>
        </div>
      </footer>

      <AnswerSheet open={sheetOpen} sections={sheetSections} onJump={jump} onClose={() => setSheetOpen(false)} />

      {/* 交卷二次确认(§7.4:列出未作答题数);失败保留本地数据供重试。 */}
      {submitState !== 'idle' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 dark:bg-neutral-950">
            <p className="text-lg font-bold">{meta?.mode === 'exam' ? '确认交卷？' : '完成这次练习？'}</p>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              {totalCount - answeredCount > 0
                ? `还有 ${totalCount - answeredCount} 题没作答。${meta?.mode === 'exam' ? '交卷后不能再改。' : '完成后这次就不能再改，可以再练一次。'}`
                : meta?.mode === 'exam'
                  ? '全部题目都已作答。交卷后不能再改。'
                  : '全部题目都已作答。完成后可以看成绩，也可以再练一次。'}
            </p>
            {submitState === 'failed' ? (
              <p className="mt-1 text-sm text-red-600">交卷没成功，检查网络后再试。答案已存在手机上，不会丢。</p>
            ) : null}
            {submitState === 'unsynced' ? (
              <p className="mt-1 text-sm text-red-600">
                还有 {unsynced} 题没传到服务器,先没给你交 —— 交了这几题会按没答算。答案都在手机上存着,
                等网络好一点再点「重试」就能补上去。
              </p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={submitState === 'busy'}
                onClick={() => setSubmitState('idle')}
                className="min-h-11 flex-1 rounded-xl border border-neutral-300 font-medium disabled:opacity-60 dark:border-neutral-700"
              >
                再看看
              </button>
              <button
                type="button"
                disabled={submitState === 'busy'}
                onClick={() => void submitExam()}
                className="min-h-11 flex-1 rounded-xl bg-blue-600 font-medium text-white disabled:opacity-60"
              >
                {submitState === 'busy'
                  ? '提交中…'
                  : submitState === 'failed' || submitState === 'unsynced'
                    ? '重试'
                    : meta?.mode === 'exam'
                      ? '确认交卷'
                      : '完成'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
