'use client'

import { useEffect, useRef } from 'react'

// 自动更新闸。装到桌面的 PWA 常常长期挂着不关，内存里一直跑着旧版 JS；这里在「打开 /
// 切回前台」时悄悄问一下服务器当前在线版本，发现已发新版就整页刷新，让浏览器重新拉取
// 最新的 HTML + 脚本。
//
// currentVersion 是本次构建烤进包里的版本号；/api/version 返回运行中 Worker 的版本号。
// 同一个构建里两者一致；线上换了新构建后，旧客户端拿到的 currentVersion 仍是旧值，问到的
// 却是新值 → 触发刷新。刷新后新包的 currentVersion === 线上版本 → 不再刷新（天然不循环）。
// 再加一层会话级保护：同一目标版本只刷新一次，万一版本始终对不上也不会无限刷。
export function VersionGate({ currentVersion }: { currentVersion: string }) {
  const busy = useRef(false)

  useEffect(() => {
    async function check() {
      if (busy.current) return
      busy.current = true
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { version?: string }
        const latest = data?.version
        if (!latest || latest === currentVersion) return
        const KEY = 'vg:reloadedFor'
        if (sessionStorage.getItem(KEY) === latest) return // 已为该版本刷过，别再刷
        sessionStorage.setItem(KEY, latest)
        window.location.reload()
      } catch {
        // 离线 / 网络抖动：忽略，下次回到前台再试。
      } finally {
        busy.current = false
      }
    }

    check()
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
    }
  }, [currentVersion])

  return null
}
