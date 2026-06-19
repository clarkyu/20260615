'use client'

import { useEffect } from 'react'

// Root-level error boundary. error.tsx only catches failures BELOW the root layout;
// an error in the root layout itself (or its providers) would otherwise fall through
// to Next's bare white screen. global-error REPLACES the whole document, so it must
// render its own <html>/<body> and cannot rely on globals.css/Tailwind being loaded —
// hence inline styles. Bilingual + provider-free for the same reason as error.tsx.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[global error]', error)
  }, [error])

  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', color: '#0f1729', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>出错了 · Something went wrong</p>
          <p style={{ fontSize: 12, color: '#6b7280', wordBreak: 'break-word', margin: '0 0 16px' }}>
            {error.message || 'Unexpected error'}{error.digest ? ` · ${error.digest}` : ''}
          </p>
          <button
            onClick={reset}
            style={{ border: 0, borderRadius: 12, background: '#0f1729', color: '#fff', padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            重试 · Retry
          </button>
        </div>
      </body>
    </html>
  )
}
