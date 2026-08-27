'use client'

import { useRef, useState } from 'react'

// 上原文、下题目的可拖动分栏(SPEC §7.3):30/50/70 三档吸附 + 全屏原文开关。
const SNAPS = [30, 50, 70]

export function SplitPane({ top, bottom }: { top: React.ReactNode; bottom: React.ReactNode }) {
  const [pct, setPct] = useState(50)
  const [full, setFull] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current || !box.current) return
    const rect = box.current.getBoundingClientRect()
    const raw = ((e.clientY - rect.top) / rect.height) * 100
    setPct(Math.min(85, Math.max(15, raw)))
  }
  function onPointerUp() {
    if (!dragging.current) return
    dragging.current = false
    setPct((p) => SNAPS.reduce((best, s) => (Math.abs(s - p) < Math.abs(best - p) ? s : best), SNAPS[0] ?? 50))
  }

  if (full) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{top}</div>
        <button type="button" onClick={() => setFull(false)} className="min-h-11 border-t border-neutral-200 text-sm text-blue-600 dark:border-neutral-800">
          收起原文,继续作答
        </button>
      </div>
    )
  }
  return (
    <div ref={box} className="flex min-h-0 flex-1 flex-col" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div style={{ flexBasis: `${pct}%` }} className="min-h-0 shrink-0 grow-0 overflow-y-auto px-4 py-3">
        {top}
      </div>
      <div
        className="flex min-h-8 touch-none items-center justify-center gap-3 border-y border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900"
        onPointerDown={(e) => {
          dragging.current = true
          ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        }}
      >
        <span className="h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700" />
        <button type="button" onClick={() => setFull(true)} className="text-xs text-blue-600">
          全屏原文
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{bottom}</div>
    </div>
  )
}
