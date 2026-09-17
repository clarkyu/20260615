import { NextResponse, type NextRequest } from 'next/server'
import { isAllowedOrigin, isWriteMethod } from '@/lib/http/origin'
import { clientKey } from '@/lib/http/client-key'
import { rateLimit } from '@/lib/rate-limit'

// 全站写接口的两道门(SPEC §9.5)。GET / HEAD / OPTIONS 直接放行,两道门都只管写。
//
// 一、来源校验:跨站的 POST / PUT / PATCH / DELETE 一律 403。
//    会话 Cookie 是 SameSite=Lax,本身已挡住多数 CSRF;这里补上 Origin 这道明确的门。
//
// 二、按用户限速:每个客户端每分钟 120 次写请求(§9.5 的口径)。
//    放在这里而不是逐个路由里加,是因为**逐个加就会漏** —— 补这道门之前,19 条写路由
//    只有 6 条有限速。个别路由另有更严的限(加入码 20/分、docx 导入 10/分、AI 生成 30/分……),
//    那些留在各自路由里,这道只是全站兜底。
//    超限回 429 不会丢作答:客户端的同步队列把非 2xx 一律当失败,行保持 dirty 退避重试
//    (硬约束 7),而交卷前会等作答全部送达。
//
// middleware 跑在 edge 运行时:只读请求头,不碰数据库,也不碰会话密钥
// (「同一个人」怎么认见 lib/http/client-key.ts)。

const WRITE_PER_MINUTE = 120

export function middleware(req: NextRequest) {
  if (!isWriteMethod(req.method)) return NextResponse.next()

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

  const key = clientKey({
    sessionCookie: req.cookies.get('zsb_session')?.value ?? null,
    forwardedFor: req.headers.get('x-forwarded-for'),
  })
  if (!rateLimit(`w:${key}`, WRITE_PER_MINUTE)) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: '操作太频繁，歇一会儿再试' } },
      { status: 429, headers: { 'retry-after': '60' } },
    )
  }

  return NextResponse.next()
}

export const config = { matcher: ['/api/:path*'] }
