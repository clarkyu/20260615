'use client'

import { useState } from 'react'

// 退出登录。POST /api/auth/logout —— 用 POST 而不是链接:写请求才过得了全站那两道门
// (middleware 的来源校验),而且 SW 认的就是 /api/auth/* 的 POST,靠它清掉带个人数据的缓存。
//
// 拿到 endSession 就整页跳到身份服务器把那边的会话也结束掉(共用手机上这一步才算真退出),
// 没有就回首页。整页跳转而不是 router.refresh():服务端渲染的页面要重新取一次会话。
export function LogoutButton({ label = '退出登录', to = '/' }: { label?: string; to?: string }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function logout() {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json().catch(() => null)) as { endSession?: string | null } | null
      // 接上了统一身份登录就跳去把那边的会话也结束(之后由它回跳本站首页);
      // 没接就地回 to(老师回教师登录页,学生回首页)。
      window.location.href = data?.endSession || to
    } catch {
      // 没退成功就明说。这里最忌讳的是跳回首页假装退出去了 —— 人会以为自己下线了,
      // 把手机递给同学,而会话其实还在。
      setBusy(false)
      setFailed(true)
    }
  }

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        className={`inline-flex min-h-11 items-center justify-center rounded-xl border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700 ${
          busy ? 'opacity-60' : ''
        }`}
      >
        {busy ? '退出中…' : label}
      </button>
      {failed ? <p className="mt-1 text-sm text-red-600 dark:text-red-400">没能退出，请检查网络后重试。</p> : null}
    </div>
  )
}
