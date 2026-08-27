'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { FillGroup } from '@/components/items/FillGroup'
import { ReorderItem } from '@/components/items/ReorderItem'
import { ShortAnswerGroup } from '@/components/items/ShortAnswerGroup'
import { TranslateC2EItem } from '@/components/items/TranslateC2EItem'
import { WritingItem } from '@/components/items/WritingItem'
import { AnswerSheet, type SheetSection } from '@/components/play/AnswerSheet'
import type { PlayGroup, PlayPaper, PlaySection } from '@/lib/play/types'
import { useAttemptStore, flushNow, type GradedFeedback } from '@/lib/sync/attempt-store'
import type { StudentAnswer } from '@/lib/schema/paper'

// 作答编排页(SPEC §7):顶栏(大题名 + 进度 + 同步状态 + 答题卡)、
// 内容区按题组类型分派渲染器、底栏(上一组/提交本组/下一组)。
// 数据来自 GET /api/attempts/:id(答案已在服务端剥离,硬约束 1)。

interface AttemptPayload {
  attempt: { id: string; mode: string; status: string }
  paper: PlayPaper
  responses: { itemId: string; answer: unknown; clientUpdatedAt: string }[]
}

function isAnswered(a: StudentAnswer | undefined): boolean {
  if (!a) return false
  if (a.type === 'text') return a.value.trim() !== ''
  if (a.type === 'sequence') return a.chunkIndexes.length > 0
  return a.keys.length > 0
}

const SYNC_LABEL = { synced: '已保存', pending: '保存中', offline: '离线,已存本机' } as const
const SYNC_DOT = { synced: 'bg-emerald-500', pending: 'bg-amber-500', offline: 'bg-red-500' } as const

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
  const { answers, syncState, applyGraded } = useAttemptStore()

  const [paper, setPaper] = useState<PlayPaper | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [groupIndex, setGroupIndex] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [checking, setChecking] = useState(false)

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
          setError('没有找到这份作答,回首页重新开始吧')
          return
        }
        const data = (await res.json()) as AttemptPayload
        await useAttemptStore.getState().init(attemptId, data.responses)
        if (!alive) return
        setPaper(data.paper)
      } catch {
        if (alive) setError('加载失败,检查一下网络再试')
      }
    })()
    return () => {
      alive = false
    }
  }, [attemptId])

  const flat = useMemo(
    () => (paper ? paper.sections.flatMap((s) => s.groups.map((g) => ({ section: s, group: g }))) : []),
    [paper],
  )
  const current: { section: PlaySection; group: PlayGroup } | undefined = flat[groupIndex]

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

  const checkGroup = useCallback(async () => {
    if (!current || checking) return
    setChecking(true)
    try {
      await flushNow() // 先冲同步队列,保证服务端拿到最新作答再判(§7.6)
      const scoreById = new Map(current.group.items.map((it) => [it.id, it.score]))
      const res = await fetch(`/api/attempts/${attemptId}/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemIds: current.group.items.map((it) => it.id) }),
      })
      if (!res.ok) return
      const json = (await res.json()) as { results?: Array<Record<string, unknown>> }
      const rows: (GradedFeedback & { itemId: string })[] = (json.results ?? []).map((r) => ({
        itemId: String(r.itemId ?? ''),
        verdict: String(r.verdict ?? 'wrong'),
        score: typeof r.score === 'number' ? r.score : 0,
        fullScore: typeof r.fullScore === 'number' ? r.fullScore : (scoreById.get(String(r.itemId ?? '')) ?? 0),
        accepted: Array.isArray(r.accepted) ? r.accepted.filter((x): x is string => typeof x === 'string') : [],
        explanation:
          typeof r.explanation === 'string' ? r.explanation : typeof r.message === 'string' ? r.message : null,
      }))
      applyGraded(rows)
    } catch {
      // 网络失败不打断作答;下次点「对答案」重试。
    } finally {
      setChecking(false)
    }
  }, [attemptId, current, checking, applyGraded])

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
    <div className="flex h-dvh flex-col overflow-hidden">
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
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="min-h-11 shrink-0 rounded-xl border border-neutral-300 px-3 text-sm font-medium dark:border-neutral-700"
          >
            答题卡
          </button>
        </div>
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
          <button
            type="button"
            disabled={checking}
            onClick={() => void checkGroup()}
            className="min-h-11 flex-1 rounded-xl bg-blue-600 px-4 font-medium text-white disabled:opacity-60"
          >
            {checking ? '对答案中…' : '对答案'}
          </button>
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
    </div>
  )
}
