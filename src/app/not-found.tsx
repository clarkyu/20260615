import Link from 'next/link'

// Custom 404. Replaces Next's bare default with a styled, bilingual page that points
// back home. Kept provider-free (static bilingual text), like error.tsx, so it never
// depends on app context that might be the very thing missing.
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="text-5xl font-black text-muted-foreground">404</p>
      <p className="text-lg font-semibold">页面不存在 · Page not found</p>
      <p className="text-xs text-muted-foreground">链接可能已失效或被移动 · The page may have moved or no longer exists.</p>
      <Link
        href="/"
        className="tap rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
      >
        返回首页 · Home
      </Link>
    </div>
  )
}
