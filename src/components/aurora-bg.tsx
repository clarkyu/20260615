// Ambient "aurora" backdrop for the logged-out / auth surfaces (login, register,
// forgot/reset, join). Purely decorative: a few large, soft, blurred colour blobs
// that drift very slowly behind the card. Pure CSS, GPU-only (animates transform/
// opacity), pointer-events-none, aria-hidden — and fully disabled under
// prefers-reduced-motion (see globals.css). Rendered as a direct child of <body> so
// its `position: fixed` is viewport-anchored (not trapped by the page-transition
// transform on <main>).
export function AuroraBg() {
  return (
    <div className="aurora" aria-hidden="true">
      <span className="aurora-blob aurora-1" />
      <span className="aurora-blob aurora-2" />
      <span className="aurora-blob aurora-3" />
    </div>
  )
}
