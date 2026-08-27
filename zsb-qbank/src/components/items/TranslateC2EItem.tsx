'use client'

import { FeedbackCard } from '@/components/play/FeedbackCard'
import { EnglishInput } from '@/components/ui/EnglishInput'
import { c2eContent, type PlayItem } from '@/lib/play/types'
import { useAttemptStore } from '@/lib/sync/attempt-store'
import { wordCount } from '@/lib/grading/normalize'

// 汉译英填空(SPEC §7.3):汉语句卡片 + 带空位英文句;词数计数实时显示。
export function TranslateC2EItem({ item }: { item: PlayItem }) {
  const { answers, graded, setAnswer } = useAttemptStore()
  const c = c2eContent(item.content)
  const a = answers[item.id]
  const value = a?.type === 'text' ? a.value : ''
  const g = graded[item.id]
  const over = wordCount(value) > c.maxWords
  const parts = c.frame.split('{{blank}}')

  return (
    <div className="rounded-2xl border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="mb-1 text-sm font-semibold">{item.number}. 汉译英</p>
      <p className="mb-2 rounded-xl bg-neutral-50 p-2 text-[17px] dark:bg-neutral-900">{c.zh}</p>
      <p className="text-[17px] leading-relaxed">
        {parts[0]}
        <span className="mx-1 inline-block min-w-24 border-b-2 border-blue-400 px-1 text-center font-medium">{value || '……'}</span>
        {parts[1] ?? ''}
        {c.hint ? <span className="ml-1 text-neutral-400">({c.hint})</span> : null}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <EnglishInput
          value={value}
          onChange={(e) => void setAnswer(item.id, { type: 'text', value: e.target.value })}
          placeholder="填英文"
          className={`min-w-0 flex-1 ${over ? 'border-red-500' : ''}`}
        />
        <span className={`shrink-0 text-sm ${over ? 'text-red-600' : 'text-neutral-400'}`}>
          {wordCount(value)}/{c.maxWords} 词
        </span>
      </div>
      {g ? <FeedbackCard {...g} /> : null}
    </div>
  )
}
