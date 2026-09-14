import { NextResponse, type NextRequest } from 'next/server'
import { isAllowedOrigin } from '@/lib/http/origin'

// 全站写接口的来源校验(SPEC §9.5):跨站的 POST / PUT / PATCH / DELETE 一律 403。
// 会话 Cookie 是 SameSite=Lax,本身已挡住多数 CSRF;这里补上 Origin 这道明确的门。
// middleware 跑在 edge 运行时:只读请求头,不碰数据库。

export function middleware(req: NextRequest) {
  const ok = isAllowedOrigin({
    method: req.method,
    origin: req.headers.get('origin'),
    host: req.headers.get('host'),
    forwardedHost: req.headers.get('x-forwarded-host'),
    forwardedProto: req.headers.get('x-forwarded-proto'),
    allowed: process.env.APP_ORIGIN ?? null,
  })
  if (!ok) {
    return NextResponse.json({ error: { code: 'forbidden', message: '请求来源不对，请从本站页面操作' } }, { status: 403 })
  }
  return NextResponse.next()
}

export const config = { matcher: ['/api/:path*'] }
