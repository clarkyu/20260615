'use client'

import { useEffect } from 'react'

// App-level error boundary. Replaces the bare "Application error" white screen with
// a friendly message that also surfaces the real error text + digest, so a failure
// in production is screenshot-able and correlatable to logs instead of opaque.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app error]', error)
  }, [error])

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="text-lg font-semibold">出错了 · Something went wrong</p>
      <p className="break-words text-xs text-muted-foreground">
        {error.message || 'Unexpected error'}
        {error.digest ? ` · ${error.digest}` : ''}
      </p>
      <button
        onClick={reset}
        className="tap rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
      >
        重试 · Retry
      </button>
    </div>
  )
}
