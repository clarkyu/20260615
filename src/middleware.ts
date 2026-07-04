import { NextResponse, type NextRequest } from 'next/server'

const CANONICAL = 'www.hihomework.com'

// The strict CSP we ultimately want to ENFORCE: no `script-src 'unsafe-inline'` — a
// per-request nonce + `strict-dynamic` instead (the audit's one CSP finding). We ship it
// as **Report-Only** first so it cannot break anything: browsers report what it *would*
// block to /api/csp-report, and once production is quiet a one-line follow-up promotes it
// to the enforced `Content-Security-Policy`. The enforced policy (next.config.mjs, with
// `'unsafe-inline'`) is left untouched meanwhile, so scripts keep running.
// style-src keeps `'unsafe-inline'` — the framework injects inline styles and the finding
// was specifically about scripts.
function strictCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com",
    "font-src 'self'",
    "connect-src 'self' https://*.r2.cloudflarestorage.com",
    "media-src 'self' blob: https://*.r2.cloudflarestorage.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'report-uri /api/csp-report',
  ].join('; ')
}

export function middleware(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').toLowerCase()
  // Force every external host (workers.dev, the bare apex, old domains, http) onto the
  // canonical https://www.hihomework.com.
  if (host && host !== CANONICAL && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    const url = new URL(request.url)
    url.protocol = 'https:'
    url.hostname = CANONICAL
    url.port = ''
    return NextResponse.redirect(url, 308)
  }

  // Per-request nonce. Setting it on the REQUEST headers lets Next stamp its own inline
  // scripts with it (and our theme script reads it via headers().get('x-nonce')); the
  // strict policy is published only as Report-Only on the RESPONSE, so nothing is enforced.
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
  const csp = strictCsp(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // Next reads the nonce for its OWN scripts from the `content-security-policy` (or the
  // `-report-only`) REQUEST header — see app-render `parseRequestHeaders`. Under `next dev`
  // this makes Next stamp every script; but OpenNext-on-Cloudflare drops the plain
  // `content-security-policy` request-header override (our custom `x-nonce` survives, so the
  // theme script is nonced, but Next's 18 framework scripts are NOT — verified in prod).
  // Next also accepts the `-report-only` name as the nonce source, and that one survives
  // OpenNext's handling — so set both; whichever reaches app-render nonces the scripts.
  requestHeaders.set('content-security-policy', csp)
  requestHeaders.set('content-security-policy-report-only', csp)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('content-security-policy-report-only', csp)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|apple-touch-icon.png|icon[-.]).*)'],
}
