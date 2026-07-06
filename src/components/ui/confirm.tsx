'use client'

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { useT } from '@/components/i18n-provider'
import { Button } from '@/components/ui/button'

// 承诺式确认弹窗，取代原生 window.confirm（手机上突兀、不跟品牌）。
// 用法：const confirm = useConfirm(); if (await confirm({ body, danger })) { … }
export interface ConfirmOptions {
  body: string
  title?: string
  danger?: boolean
  okLabel?: string
}

// 给 <form action={…}> 的 onSubmit 用：先拦下提交弹确认，确认后再放行（用 form 上的
// 一次性标记重新 requestSubmit，避免 window.confirm 的同步阻塞）。
export function confirmSubmit(
  confirm: (o: ConfirmOptions) => Promise<boolean>,
  opts: ConfirmOptions,
) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget
    if (form.dataset.confirmed === '1') { form.dataset.confirmed = ''; return }
    e.preventDefault()
    void confirm(opts).then((ok) => {
      if (ok) { form.dataset.confirmed = '1'; form.requestSubmit() }
    })
  }
}

const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false)

export function useConfirm() {
  return useContext(ConfirmCtx)
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const t = useT()
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolverRef = useRef<((ok: boolean) => void) | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const bodyId = useId()

  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current = resolve
        setOpts(o)
      }),
    [],
  )

  const close = useCallback((ok: boolean) => {
    resolverRef.current?.(ok)
    resolverRef.current = null
    setOpts(null)
  }, [])

  // Esc 取消；Tab 在弹窗按钮间循环（焦点陷阱），键盘焦点不会溜到模态框背后——
  // 与 RecordConsentNotice 的键盘契约一致。
  useEffect(() => {
    if (!opts) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(false); return }
      const root = panelRef.current
      if (e.key !== 'Tab' || !root) return
      const f = root.querySelectorAll<HTMLButtonElement>('button')
      if (f.length === 0) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [opts, close])

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {opts ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={opts.title ? titleId : bodyId}
          aria-describedby={opts.title ? bodyId : undefined}
          className="safe-bottom fixed inset-0 z-[60] flex items-end justify-center bg-foreground/40 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => close(false)}
        >
          <div
            ref={panelRef}
            className="animate-in-up w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            {opts.title ? <p id={titleId} className="text-base font-bold tracking-tight">{opts.title}</p> : null}
            <p id={bodyId} className={'whitespace-pre-wrap text-sm text-muted-foreground' + (opts.title ? ' mt-1.5' : '')}>{opts.body}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => close(false)}>{t('confirm.cancel')}</Button>
              <Button variant={opts.danger ? 'destructive' : 'default'} size="sm" autoFocus onClick={() => close(true)}>
                {opts.okLabel ?? t('confirm.ok')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmCtx.Provider>
  )
}
