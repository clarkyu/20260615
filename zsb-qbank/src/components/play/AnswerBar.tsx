'use client'

import { useEffect, useRef, useState } from 'react'
import { EnglishInput } from '@/components/ui/EnglishInput'
import { wordCount } from '@/lib/grading/normalize'

// 作答条(SPEC §7.2):固定视口底部,键盘弹出时用 visualViewport 贴到键盘上沿;
// 左侧题号+提示词+规则,中间 EnglishInput,右侧 上一空/下一空/确定;
// 词数超限输入框变红并提示。

export function AnswerBar({
  blankLabel,
  hint,
  maxWords,
  value,
  onChange,
  onPrev,
  onNext,
  onConfirm,
  isLast,
}: {
  blankLabel: string
  hint?: string
  maxWords: number
  value: string
  onChange: (v: string) => void
  onPrev: () => void
  onNext: () => void
  onConfirm: () => void
  isLast: boolean
}) {
  const bar = useRef<HTMLDivElement>(null)
  const [lift, setLift] = useState(0)

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const onResize = () => {
      // 键盘高度 ≈ 布局视口高 −(可视视口高 + 可视视口顶部偏移)。
      setLift(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    onResize()
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onResize)
    }
  }, [])

  const over = wordCount(value) > maxWords
  const rule = maxWords === 1 ? '只填一词' : `不超过 ${maxWords} 个词`

  return (
    <div
      ref={bar}
      style={{ transform: lift > 0 ? `translateY(-${lift}px)` : undefined }}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95"
    >
      <div className="mx-auto flex max-w-xl items-center gap-2 px-3 py-2">
        <div className="shrink-0 text-sm">
          <div className="font-semibold">
            {blankLabel}
            {hint ? <span className="ml-1 font-normal text-neutral-500">({hint})</span> : null}
          </div>
          <div className={over ? 'text-red-600' : 'text-neutral-400'}>{over ? '超出词数' : rule}</div>
        </div>
        <EnglishInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (isLast) onConfirm()
              else onNext()
            }
          }}
          enterKeyHint={isLast ? 'done' : 'next'}
          placeholder="输入英文"
          className={`min-w-0 flex-1 ${over ? 'border-red-500' : ''}`}
        />
        <button type="button" onClick={onPrev} aria-label="上一空" className="min-h-11 min-w-11 rounded-xl border border-neutral-300 text-lg dark:border-neutral-700">
          ‹
        </button>
        <button type="button" onClick={onNext} aria-label="下一空" className="min-h-11 min-w-11 rounded-xl border border-neutral-300 text-lg dark:border-neutral-700">
          ›
        </button>
        <button type="button" onClick={onConfirm} className="min-h-11 rounded-xl bg-blue-600 px-4 font-medium text-white">
          确定
        </button>
      </div>
    </div>
  )
}
