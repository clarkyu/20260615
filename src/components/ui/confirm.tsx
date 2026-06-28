'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
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

  // Esc 取消（弹窗打开时）。
  useEffect(() => {
    if (!opts) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false) }
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
          className="safe-bottom fixed inset-0 z-[60] flex items-end justify-center bg-foreground/40 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => close(false)}
        >
          <div
            className="animate-in-up w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            {opts.title ? <p className="text-base font-bold tracking-tight">{opts.title}</p> : null}
            <p className={'whitespace-pre-wrap text-sm text-muted-foreground' + (opts.title ? ' mt-1.5' : '')}>{opts.body}</p>
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
