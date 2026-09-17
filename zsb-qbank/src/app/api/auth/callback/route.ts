import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db/client'
import { ensureUser } from '@/lib/db/queries'
import {
  OidcError,
  decodeJwtPayload,
  exchangeCode,
  getOidcConfig,
  idTokenForHint,
  landingFor,
  toSessionUser,
  validateClaims,
  type LoginErrorCode,
} from '@/lib/auth/oidc'
import { getSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

// GET /api/auth/callback(SPEC §9.4):Casdoor 回调——核对 state → 用授权码 + verifier 换 token →
// 校验 id_token 声明(iss / aud / exp / iat / nonce)→ 映射角色 → 建会话 → 回跳。
// 失败只回一个固定的原因码,页面按码显示中文提示:URL 里的文字会原样显示给用户,
// 让它可被外部构造等于在学校域名上给钓鱼留了个位置。详细原因只进服务端日志。
function fail(origin: string, code: LoginErrorCode, detail?: string) {
  if (detail) console.warn(`[auth] casdoor 登录失败(${code}):${detail}`)
  const url = new URL('/teacher/login', origin)
  url.searchParams.set('err', code)
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const cfg = getOidcConfig(process.env, origin)
  if (!cfg) return fail(origin, 'unconfigured')

  const sp = req.nextUrl.searchParams
  const err = sp.get('error')
  if (err) return fail(origin, 'denied', `${err} ${sp.get('error_description') ?? ''}`.trim())
  const code = sp.get('code')
  const state = sp.get('state')
  if (!code || !state) return fail(origin, 'params')

  const session = await getSession()
  const pending = session.oidc
  // 一次性状态:用过即清,避免重放
  session.oidc = undefined
  if (!pending) {
    await session.save()
    return fail(origin, 'state')
  }
  if (pending.state !== state) {
    await session.save()
    return fail(origin, 'state', 'state 不匹配')
  }
  if (Date.now() - pending.startedAt > 10 * 60_000) {
    await session.save()
    return fail(origin, 'timeout')
  }

  try {
    const token = await exchangeCode(cfg, { code, verifier: pending.verifier })
    const claims = decodeJwtPayload(token.id_token!)
    const bad = validateClaims(claims, cfg, pending.nonce, Date.now())
    if (bad || !claims) {
      await session.save()
      return fail(origin, 'claims', bad ?? 'id_token 无效')
    }
    const user = toSessionUser(claims, cfg)
    session.user = user
    session.idToken = idTokenForHint(token.id_token) // 登出要拿它当 id_token_hint
    await session.save()
    // 建档(attempts / responses 的外键需要 users 行)
    await ensureUser(getDb(), user)
    console.log(`[auth] casdoor 登录成功 role=${user.role}`) // 不记 sub 与姓名(§9.5)
    return NextResponse.redirect(new URL(landingFor(user.role, pending.returnTo), origin))
  } catch (e) {
    await session.save()
    return fail(origin, 'token', e instanceof OidcError || e instanceof Error ? e.message : String(e))
  }
}
