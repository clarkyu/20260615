'use client'

import { SplitPane } from '@/components/play/SplitPane'
import { FeedbackCard } from '@/components/play/FeedbackCard'
import { EnglishTextarea } from '@/components/ui/EnglishInput'
import { questionContent, type PlayGroup } from '@/lib/play/types'
import { useAttemptStore } from '@/lib/sync/attempt-store'

// 阅读问答题组(SPEC §7.3):上原文下问题分栏;每题一个自动增高文本域;
// 翻译题原句以引用样式突出。主观题练习模式下判分反馈显示「AI 评分中/待评」(M4 接入)。

export function ShortAnswerGroup({ group }: { group: PlayGroup }) {
  const { answers, graded, setAnswer } = useAttemptStore()

  const questions = (
    <div className="space-y-4 pb-10">
      {group.items.map((it) => {
        const c = questionContent(it.content)
        const a = answers[it.id]
        const value = a?.type === 'text' ? a.value : ''
        const g = graded[it.id]
        return (
          <div key={it.id}>
            <p className="mb-1 text-[16px] font-medium">
              {it.number}. {it.type === 'translate_e2c' ? '把下面的句子翻译成中文:' : c.question}
            </p>
            {it.type === 'translate_e2c' ? (
              <blockquote className="mb-2 rounded-lg border-l-4 border-blue-400 bg-blue-50 p-2 text-[16px] dark:bg-blue-950">
                {c.source}
              </blockquote>
            ) : null}
            <EnglishTextarea
              value={value}
              lang={it.type === 'translate_e2c' ? 'zh-CN' : 'en'}
              onChange={(e) => {
                const el = e.target
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`
                void setAnswer(it.id, { type: 'text', value: el.value })
              }}
              placeholder={it.type === 'translate_e2c' ? '写下你的中文翻译' : '用完整的英文句子回答'}
            />
            {g ? <FeedbackCard {...g} /> : null}
          </div>
        )
      })}
    </div>
  )

  return group.stimulus ? (
    <SplitPane
      top={
        <article className="whitespace-pre-wrap text-[17px] leading-relaxed">
          {group.stimulus.title ? <h3 className="mb-2 font-semibold">{group.stimulus.title}</h3> : null}
          {group.stimulus.body}
        </article>
      }
      bottom={questions}
    />
  ) : (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{questions}</div>
  )
}
