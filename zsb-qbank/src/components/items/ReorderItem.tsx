'use client'

import { useMemo } from 'react'
import { FeedbackCard } from '@/components/play/FeedbackCard'
import { reorderContent, type PlayItem } from '@/lib/play/types'
import { useAttemptStore } from '@/lib/sync/attempt-store'

// 连词成句(SPEC §7.3):点选词块追加进句子区,点句子区词块退回;重置;
// 句末标点自动置尾只影响显示。

export function ReorderItem({ item }: { item: PlayItem }) {
  const { answers, graded, setAnswer } = useAttemptStore()
  const chunks = useMemo(() => reorderContent(item.content).chunks, [item.content])
  const a = answers[item.id]
  const picked: number[] = a?.type === 'sequence' ? a.chunkIndexes : []
  const remaining = chunks.map((_, i) => i).filter((i) => !picked.includes(i))
  const g = graded[item.id]

  const sentence = picked.map((i) => chunks[i] ?? '').join(' ')
  const display = sentence.replace(/\s*([.?!])\s*/g, '$1').replace(/([.?!])(?=.)/, '$1 ') // 展示层小整理

  const set = (next: number[]) => void setAnswer(item.id, { type: 'sequence', chunkIndexes: next })

  return (
    <div className="rounded-2xl border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="mb-2 text-sm font-semibold">{item.number}. 连词成句</p>
      <div className="mb-2 min-h-12 rounded-xl bg-neutral-50 p-2 dark:bg-neutral-900">
        {picked.length === 0 ? (
          <span className="text-sm text-neutral-400">点下面的词块,把句子拼出来</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {picked.map((ci, pos) => (
              <button
                key={`${ci}-${pos}`}
                type="button"
                onClick={() => set(picked.filter((_, j) => j !== pos))}
                className="min-h-11 rounded-lg border border-blue-300 bg-blue-50 px-2 text-[16px] dark:border-blue-800 dark:bg-blue-950"
              >
                {chunks[ci]}
              </button>
            ))}
          </div>
        )}
        {picked.length > 0 ? <p className="mt-2 text-sm text-neutral-500">{display}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {remaining.map((ci) => (
          <button
            key={ci}
            type="button"
            onClick={() => set([...picked, ci])}
            className="min-h-11 rounded-lg border border-neutral-300 px-2 text-[16px] dark:border-neutral-700"
          >
            {chunks[ci]}
          </button>
        ))}
        {picked.length > 0 ? (
          <button type="button" onClick={() => set([])} className="min-h-11 rounded-lg px-2 text-sm text-neutral-500">
            重置
          </button>
        ) : null}
      </div>
      {g ? <FeedbackCard {...g} /> : null}
    </div>
  )
}
