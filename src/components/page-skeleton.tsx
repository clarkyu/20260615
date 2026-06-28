// Shared loading fallback for route segments (Next.js loading.tsx). The app shell
// (header / bottom nav) stays put while a page's server component awaits its data on
// D1 — this fills the content area with a shimmer placeholder instead of a blank gap,
// so navigation feels instant. The `.skeleton` shimmer is disabled under
// prefers-reduced-motion (globals.css). Decorative bars are aria-hidden; a single
// visually-hidden status announces "loading" to screen readers.
export function PageSkeleton() {
  return (
    <div className="space-y-3 py-2">
      <span className="sr-only" role="status">加载中 · Loading…</span>
      <div className="skeleton h-8 w-40 rounded-lg" aria-hidden="true" />
      <div className="skeleton h-24 w-full rounded-lg" aria-hidden="true" />
      <div className="skeleton h-24 w-full rounded-lg" aria-hidden="true" />
      <div className="skeleton h-24 w-full rounded-lg" aria-hidden="true" />
    </div>
  )
}
