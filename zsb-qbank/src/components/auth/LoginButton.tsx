'use client'

import { useState } from 'react'

// 统一身份登录入口(Casdoor):走 GET /api/auth/login,登录后回到 returnTo。
// 用 <a> 跳转(授权码流要整页跳),不用 fetch。
export function LoginButton({ returnTo, label = '登录', variant = 'primary' }: { returnTo?: string; label?: string; variant?: 'primary' | 'outline' }) {
  const [busy, setBusy] = useState(false)
  const href = `/api/auth/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`
  return (
    <a
      href={href}
      onClick={() => setBusy(true)}
      aria-disabled={busy}
      className={`inline-flex min-h-11 items-center justify-center rounded-xl px-5 font-medium ${
        variant === 'primary' ? 'bg-blue-600 text-white' : 'border border-blue-600 text-blue-700 dark:text-blue-300'
      } ${busy ? 'opacity-60' : ''}`}
    >
      {busy ? '跳转中…' : label}
    </a>
  )
}
