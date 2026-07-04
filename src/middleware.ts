import { NextResponse, type NextRequest } from 'next/server'

const CANONICAL = 'www.hihomework.com'

// The strict CSP we WANT to enforce: no `script-src 'unsafe-inline'` — a per-request nonce +
// `strict-dynamic` instead (the audit's one CSP finding). It ships as **Report-Only** and
// currently CANNOT be promoted to enforced on Cloudflare: workerd strips the request header
// Next reads to nonce its own scripts, and the production render nonces framework scripts via
// Next's minified runtime (not a code path we can patch cleanly). Enforcing would block those
// un-nonced scripts and white-screen the app. Full investigation + upstream issue:
// docs/CSP-NONCE-OPENNEXT.md. Meanwhile Report-Only reports would-be violations to
// /api/csp-report, and the enforced policy in next.config.mjs (with `'unsafe-inline'`) keeps
// scripts running. style-src keeps `'unsafe-inline'` — the framework injects inline styles and
// the finding was specifically about scripts.
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

  // Per-request nonce. On the REQUEST headers so Next stamps its own scripts with it under
  // `next dev` (and our theme script reads it via headers().get('x-nonce')); the strict policy
  // is published only as Report-Only on the RESPONSE, so nothing is enforced.
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
  const csp = strictCsp(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // Next reads the nonce for its own scripts from the `content-security-policy` request header
  // (app-render `parseRequestHeaders`). This works under `next dev` but NOT in production —
  // workerd strips it before Next reads it (docs/CSP-NONCE-OPENNEXT.md). Kept for `next dev`
  // and forward-compat; it's a no-op in prod today.
  requestHeaders.set('content-security-policy', csp)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('content-security-policy-report-only', csp)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|apple-touch-icon.png|icon[-.]).*)'],
}
