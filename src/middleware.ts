import { NextResponse, type NextRequest } from 'next/server'

const CANONICAL = 'www.hihomework.com'

// Force every external host (workers.dev, the bare apex, old domains, http)
// onto the canonical https://www.hihomework.com.
export function middleware(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').toLowerCase()
  if (host && host !== CANONICAL && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    const url = new URL(request.url)
    url.protocol = 'https:'
    url.hostname = CANONICAL
    url.port = ''
    return NextResponse.redirect(url, 308)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)'],
}
