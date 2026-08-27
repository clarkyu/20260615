'use client'

import { useMemo, useState } from 'react'
import { FrameText } from '@/components/play/FrameText'
import { AnswerBar } from '@/components/play/AnswerBar'
import { SplitPane } from '@/components/play/SplitPane'
import { FeedbackCard } from '@/components/play/FeedbackCard'
import { fillContent, type PlayGroup } from '@/lib/play/types'
import { useAttemptStore } from '@/lib/sync/attempt-store'

// fill 题组(SPEC §7.3):cloze = 短文内嵌空位;reading_fill = 上原文下摘要分栏。
// 点芯片切换当前空;作答条固定底部;输入实时回填芯片。

export function FillGroup({ group }: { group: PlayGroup }) {
  const { answers, graded, setAnswer } = useAttemptStore()
  const fillItems = useMemo(() => group.items.filter((it) => it.type === 'fill'), [group.items])
  const byNumber = useMemo(() => new Map(fillItems.map((it) => [String(it.number), it])), [fillItems])
  const [active, setActive] = useState<string | null>(fillItems[0] ? String(fillItems[0].number) : null)

  const activeItem = active ? byNumber.get(active) : undefined
  const values: Record<string, string> = {}
  for (const it of fillItems) {
    const a = answers[it.id]
    values[String(it.number)] = a?.type === 'text' ? a.value : ''
  }

  const order = fillItems.map((it) => String(it.number))
  const idx = active ? order.indexOf(active) : -1
  const move = (d: number) => {
    if (order.length === 0) return
    const next = order[(idx + d + order.length) % order.length]
    setActive(next ?? null)
    // 把芯片滚到作答条上方可见(SPEC §7.2)。
    setTimeout(() => document.querySelector(`[data-blank="${next}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)
  }

  const frameNode = (
    <div className="pb-28">
      <FrameText
        frame={group.frame ?? ''}
        values={values}
        activeBlank={active}
        statusOf={(b) => {
          const it = byNumber.get(b)
          const g = it ? graded[it.id] : undefined
          return g ? (g.verdict === 'correct' ? 'correct' : 'wrong') : null
        }}
        onBlankClick={setActive}
      />
      {fillItems.map((it) => {
        const g = graded[it.id]
        return g ? <FeedbackCard key={it.id} {...g} /> : null
      })}
    </div>
  )

  return (
    <>
      {group.kind === 'reading_fill' && group.stimulus ? (
        <SplitPane
          top={
            <article className="whitespace-pre-wrap text-[17px] leading-relaxed">
              {group.stimulus.title ? <h3 className="mb-2 font-semibold">{group.stimulus.title}</h3> : null}
              {group.stimulus.body}
            </article>
          }
          bottom={frameNode}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{frameNode}</div>
      )}
      {activeItem ? (
        <AnswerBar
          blankLabel={String(activeItem.number)}
          hint={fillContent(activeItem.content).hint}
          maxWords={fillContent(activeItem.content).maxWords}
          value={values[active ?? ''] ?? ''}
          onChange={(v) => void setAnswer(activeItem.id, { type: 'text', value: v })}
          onPrev={() => move(-1)}
          onNext={() => move(1)}
          onConfirm={() => move(1)}
          isLast={idx === order.length - 1}
        />
      ) : null}
    </>
  )
}
