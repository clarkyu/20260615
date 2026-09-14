import { NextResponse, type NextRequest } from 'next/server'
import { buildAuthorizeUrl, getOidcConfig, newAuthRequest, safeReturnTo } from '@/lib/auth/oidc'
import { getSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

// GET /api/auth/login(SPEC §9.4 / §9.1):跳转到 Casdoor 授权页(授权码 + PKCE)。
// state / nonce / code_verifier 存进加密会话 Cookie,回调时逐项核对。
// ?returnTo=/teacher 支持登录后回到原页面(只接受站内相对路径)。
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const cfg = getOidcConfig(process.env, origin)
  if (!cfg) {
    return NextResponse.redirect(new URL('/teacher/login?err=unconfigured', origin))
  }
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get('returnTo'))
  const authReq = newAuthRequest()
  const session = await getSession()
  session.oidc = { ...authReq, returnTo, startedAt: Date.now() }
  await session.save()
  return NextResponse.redirect(buildAuthorizeUrl(cfg, authReq))
}
