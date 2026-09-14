'use client'

import { useMemo, useState } from 'react'
import { EnglishInput } from '@/components/ui/EnglishInput'
import { wordCount } from '@/lib/grading/normalize'
import type { StudentAnswer } from '@/lib/schema/paper'

// 训练模式单题渲染(SPEC §6 / §7.3):默认只展示 contextSnippet,可展开全文;三级脚手架:
// 一级选词块(点即答)、二级首字母掩码 + 输入、三级自由拼写;连词成句点选词块。
// 英文输入一律 EnglishInput(硬约束 3);可点元素 ≥ 44px(硬约束 5)。

export interface TrainItemData {
  itemId: string
  number: number
  type: string
  score: number
  content: Record<string, unknown>
  contextSnippet: string | null
  knowledgeTags: string[]
  paperTitle: string | null
  group: { kind: string; stimulus: { kind: string; title?: string; body: string } | null; frame: string | null }
  scaffold: { level: 1 | 2 | 3; off: boolean; options?: string[]; mask?: string } | null
  review: boolean
  progress: { attempts: number; correct: number }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d)

/** 把 {{n}} / {{blank}} 换成当前作答的展示片段。 */
function Frame({ text, value, active }: { text: string; value: string; active: boolean }) {
  const parts = text.split(/\{\{\w+\}\}/)
  return (
    <p className="text-[17px] leading-relaxed">
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 ? (
            <span className={`mx-1 inline-block min-w-16 border-b-2 px-1 text-center font-medium ${active ? 'border-blue-500 text-blue-700 dark:text-blue-300' : 'border-neutral-300 text-neutral-400'}`}>{value || '……'}</span>
          ) : null}
        </span>
      ))}
    </p>
  )
}

export function TrainItem({ item, disabled, onSubmit }: { item: TrainItemData; disabled: boolean; onSubmit: (a: StudentAnswer) => void }) {
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [expanded, setExpanded] = useState(false)
  const chunks = useMemo(() => (Array.isArray(item.content.chunks) ? (item.content.chunks as string[]) : []), [item.content])
  const sc = item.scaffold
  const level = sc?.off ? 3 : (sc?.level ?? 3)

  const header = (
    <div className="flex items-center justify-between text-xs text-neutral-500">
      <span>
        {item.type === 'fill' ? '填词' : item.type === 'translate_c2e_fill' ? '汉译英' : '连词成句'}
        {item.paperTitle ? ` · ${item.paperTitle.replace(/普通专升本|《大学英语》|真题/g, '').trim()}` : ''}
        {item.review ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-900 dark:text-amber-200">复习</span> : null}
      </span>
      {sc ? <span>{sc.off ? '脚手架已关闭' : level === 1 ? '一级 · 选词块' : level === 2 ? '二级 · 首字母' : '三级 · 自由拼写'}</span> : null}
    </div>
  )

  const fullText = item.group.stimulus?.body || item.group.frame
  const expandButton = fullText ? (
    <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 min-h-11 text-sm text-blue-600">
      {expanded ? '收起全文' : '展开全文'}
    </button>
  ) : null
  const fullView = expanded && fullText ? (
    <div className="mt-2 max-h-72 overflow-y-auto rounded-xl bg-neutral-50 p-3 text-[15px] leading-relaxed whitespace-pre-wrap dark:bg-neutral-900">
      {item.group.stimulus?.title ? <p className="mb-1 font-semibold">{item.group.stimulus.title}</p> : null}
      {item.group.stimulus?.body}
      {item.group.frame ? <p className={item.group.stimulus?.body ? 'mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-700' : ''}>{item.group.frame.replace(/\{\{(\d+)\}\}/g, '(__$1__)')}</p> : null}
    </div>
  ) : null

  if (item.type === 'reorder') {
    const remaining = chunks.map((_, i) => i).filter((i) => !picked.includes(i))
    return (
      <div className="rounded-2xl border border-neutral-200 p-3 dark:border-neutral-800">
        {header}
        <div className="mt-2 min-h-12 rounded-xl bg-neutral-50 p-2 dark:bg-neutral-900">
          {picked.length === 0 ? (
            <span className="text-sm text-neutral-400">点下面的词块，把句子拼出来</span>
          ) : (
            <div className="flex flex-wrap gap-2">
              {picked.map((ci, pos) => (
                <button key={`${ci}-${pos}`} type="button" disabled={disabled} onClick={() => setPicked(picked.filter((_, j) => j !== pos))} className="min-h-11 rounded-lg border border-blue-300 bg-blue-50 px-2 text-[16px] dark:border-blue-800 dark:bg-blue-950">
                  {chunks[ci]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {remaining.map((i) => (
            <button key={i} type="button" disabled={disabled} onClick={() => setPicked([...picked, i])} className="min-h-11 rounded-lg border border-neutral-300 px-3 text-[16px] dark:border-neutral-700">
              {chunks[i]}
            </button>
          ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" disabled={disabled || picked.length === 0} onClick={() => setPicked([])} className="min-h-11 rounded-xl border border-neutral-300 px-4 dark:border-neutral-700">
            重来
          </button>
          <button type="button" disabled={disabled || picked.length !== chunks.length} onClick={() => onSubmit({ type: 'sequence', chunkIndexes: picked })} className="min-h-11 rounded-xl bg-blue-600 px-5 font-medium text-white disabled:opacity-60">
            提交
          </button>
        </div>
      </div>
    )
  }

  const isC2e = item.type === 'translate_c2e_fill'
  const frame = isC2e ? str(item.content.frame) : (item.contextSnippet ?? '')
  const hint = str(item.content.hint)
  const maxWords = num(item.content.maxWords, isC2e ? 2 : 1)
  const over = wordCount(text) > maxWords
  return (
    <div className="rounded-2xl border border-neutral-200 p-3 dark:border-neutral-800">
      {header}
      {isC2e ? <p className="mt-2 rounded-xl bg-neutral-50 p-2 text-[17px] dark:bg-neutral-900">{str(item.content.zh)}</p> : null}
      <div className="mt-2">
        {frame ? <Frame text={frame} value={text} active={!disabled} /> : <p className="text-sm text-neutral-400">（这题没有上下文片段，请展开全文作答）</p>}
        {hint ? <p className="mt-1 text-sm text-neutral-500">提示词：{hint}</p> : null}
        {expandButton}
        {fullView}
      </div>
      {level === 1 && sc?.options ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {sc.options.map((o) => (
            <button key={o} type="button" disabled={disabled} onClick={() => onSubmit({ type: 'text', value: o })} className="min-h-12 rounded-xl border border-neutral-300 px-3 text-[16px] font-medium disabled:opacity-60 dark:border-neutral-700">
              {o}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-3">
          {level === 2 && sc?.mask ? <p className="mb-2 font-mono text-lg tracking-wider text-neutral-600 dark:text-neutral-300">{sc.mask}</p> : null}
          <div className="flex items-center gap-2">
            <EnglishInput
              value={text}
              disabled={disabled}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && text.trim() && !over) onSubmit({ type: 'text', value: text })
              }}
              placeholder={maxWords === 1 ? '填一个词' : `不超过 ${maxWords} 个词`}
              enterKeyHint="done"
              className={`min-w-0 flex-1 ${over ? 'border-red-500' : ''}`}
            />
            <button type="button" disabled={disabled || !text.trim() || over} onClick={() => onSubmit({ type: 'text', value: text })} className="min-h-11 rounded-xl bg-blue-600 px-4 font-medium text-white disabled:opacity-60">
              提交
            </button>
          </div>
          <p className={`mt-1 text-xs ${over ? 'text-red-600' : 'text-neutral-400'}`}>
            {wordCount(text)}/{maxWords} 词{over ? '，超出词数' : ''}
          </p>
        </div>
      )}
    </div>
  )
}
