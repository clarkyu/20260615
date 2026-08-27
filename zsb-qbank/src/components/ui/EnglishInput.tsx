'use client'

import { forwardRef } from 'react'

// 英文作答唯一允许的输入组件(CLAUDE.md 硬约束 3):关闭自动纠错/首字母大写/
// 拼写检查/自动补全,字号 ≥16px(text-base)防 iOS 聚焦放大。
const FIXED = {
  autoCapitalize: 'off',
  autoCorrect: 'off',
  spellCheck: false,
  autoComplete: 'off',
  inputMode: 'text',
  lang: 'en',
} as const

export const EnglishInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function EnglishInput({ className = '', ...props }, ref) {
    return (
      <input
        ref={ref}
        {...FIXED}
        enterKeyHint={props.enterKeyHint ?? 'next'}
        {...props}
        className={`min-h-11 rounded-xl border border-neutral-300 px-3 text-base outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900 ${className}`}
      />
    )
  },
)

export const EnglishTextarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function EnglishTextarea({ className = '', ...props }, ref) {
    return (
      <textarea
        ref={ref}
        {...FIXED}
        rows={props.rows ?? 2}
        {...props}
        className={`w-full resize-none rounded-xl border border-neutral-300 p-3 text-base leading-relaxed outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900 ${className}`}
      />
    )
  },
)
