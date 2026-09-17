import { NextResponse, type NextRequest } from 'next/server'
import { buildEndSessionUrl, endSessionEndpoint, getOidcConfig } from '@/lib/auth/oidc'
import { getSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

// POST /api/auth/logout:先把本站会话清干净,再尽力去结束身份服务器那边的会话。
//
// 顺序是有意的。清本地不依赖网络,一定成功;问身份服务器要登出地址会超时、会失败,
// 那时也只是少跳一步,人已经退出来了 —— 共用手机上「退不出去」= 下一个人顶着上一个人
// 的身份做题,这个后果比「没能同时结束 IdP 会话」严重得多。
//
// 只有 Casdoor 登录的会话才跳 IdP:开发登录(dev-*)那边根本没有会话,跳过去纯属添乱。
// 前端拿 endSession 整页跳转(见 components/auth/LogoutButton)。
export async function POST(req: NextRequest) {
  const session = await getSession()
  const idToken = session.idToken
  const fromCasdoor = session.user?.sub.startsWith('casdoor:') ?? false
  session.destroy()

  const origin = ((process.env.APP_ORIGIN?.split(',')[0] ?? '').trim() || req.nextUrl.origin).replace(/\/+$/, '')
  const cfg = fromCasdoor ? getOidcConfig(process.env, origin) : null
  let endSession: string | null = null
  if (cfg) {
    const endpoint = await endSessionEndpoint(cfg)
    if (endpoint) endSession = buildEndSessionUrl(endpoint, cfg, { idToken, postLogoutRedirectUri: `${origin}/` })
  }

  return NextResponse.json({ ok: true, endSession })
}
