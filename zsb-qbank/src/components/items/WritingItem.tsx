'use client'

import { useState } from 'react'
import { FeedbackCard } from '@/components/play/FeedbackCard'
import { EnglishTextarea } from '@/components/ui/EnglishInput'
import { writingContent, type PlayItem } from '@/lib/play/types'
import { useAttemptStore } from '@/lib/sync/attempt-store'
import { wordCount } from '@/lib/grading/normalize'

// 作文(SPEC §7.3):题目与要求可折叠;全高文本域;右下实时字数,达标变绿;
// 练习模式提供要点自查复选框。
export function WritingItem({ item }: { item: PlayItem }) {
  const { answers, graded, setAnswer } = useAttemptStore()
  const c = writingContent(item.content)
  const a = answers[item.id]
  const value = a?.type === 'text' ? a.value : ''
  const g = graded[item.id]
  const words = wordCount(value)
  const [open, setOpen] = useState(true)

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
      <div className="mb-2 rounded-2xl border border-neutral-200 dark:border-neutral-800">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-h-11 w-full items-center justify-between px-3 text-left font-medium">
          {item.number}. 作文({c.genre || '应用文'})
          <span className="text-sm text-neutral-400">{open ? '收起' : '展开'}</span>
        </button>
        {open ? (
          <div className="border-t border-neutral-200 p-3 text-[16px] dark:border-neutral-800">
            <p className="whitespace-pre-wrap">{c.prompt}</p>
            <ul className="mt-2 space-y-1">
              {c.requirements.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4" aria-label="自查要点" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <EnglishTextarea
          value={value}
          onChange={(e) => void setAnswer(item.id, { type: 'text', value: e.target.value })}
          placeholder="在这里写你的邮件正文"
          className="min-h-48 flex-1"
        />
        <span
          className={`pointer-events-none absolute bottom-2 right-3 rounded-md px-1.5 text-sm ${
            words >= c.minWords ? 'text-emerald-600' : 'text-neutral-400'
          }`}
        >
          {words} 词{words < c.minWords ? ` / 至少 ${c.minWords}` : ''}
        </span>
      </div>
      {g ? <FeedbackCard {...g} /> : null}
    </div>
  )
}
