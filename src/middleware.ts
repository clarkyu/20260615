import { NextResponse, type NextRequest } from 'next/server'

const CANONICAL = 'www.hihomework.com'

// The strict CSP we WANT to enforce: no `script-src 'unsafe-inline'` — a per-request nonce +
// `strict-dynamic` instead (the audit's one CSP finding). It ships as **Report-Only** and
// cannot yet be promoted to enforced: OpenNext-on-Cloudflare (workerd) strips the request
// header Next needs to nonce its OWN scripts, so under enforcement those scripts would be
// blocked and white-screen the app (see the detailed note in `middleware()` below, and the
// upstream issue). Meanwhile Report-Only reports would-be violations to /api/csp-report, and
// the enforced policy in next.config.mjs (with `'unsafe-inline'`) keeps scripts running.
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

  // Per-request nonce. On the REQUEST headers so Next stamps its own scripts with it under
  // `next dev` (and our theme script reads it via headers().get('x-nonce')); the strict policy
  // ships only as Report-Only on the RESPONSE, so nothing is enforced.
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
  const csp = strictCsp(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // Next's app-render reads the nonce for its OWN (framework) scripts ONLY from the
  // `content-security-policy` request header (see `parseRequestHeaders`). This works under
  // `next dev` (30/30 scripts nonced) but NOT in production: Cloudflare's workerd strips
  // `content-security-policy` (and `-report-only`) from request headers when OpenNext's edge
  // converter rebuilds the forwarded `Request` — our custom `x-nonce` survives, so only the
  // theme script gets a nonce (verified in prod: 1/19). That's why the policy stays
  // Report-Only: enforcing it would block Next's un-nonced scripts and white-screen the app.
  // This line is a no-op in prod today but is kept so the enforce-flip is a one-liner the
  // moment OpenNext/workerd stops stripping the header. Full analysis + upstream issue text +
  // the exact flip steps: docs/CSP-NONCE-OPENNEXT.md.
  requestHeaders.set('content-security-policy', csp)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('content-security-policy-report-only', csp)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|apple-touch-icon.png|icon[-.]).*)'],
}
