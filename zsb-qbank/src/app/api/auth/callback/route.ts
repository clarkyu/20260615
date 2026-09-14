import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db/client'
import { ensureUser } from '@/lib/db/queries'
import { OidcError, decodeJwtPayload, exchangeCode, getOidcConfig, landingFor, toSessionUser, validateClaims } from '@/lib/auth/oidc'
import { getSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

// GET /api/auth/callback(SPEC §9.4):Casdoor 回调——核对 state → 用授权码 + verifier 换 token →
// 校验 id_token 声明(iss / aud / exp / nonce)→ 映射角色 → 建会话 → 回跳。
// 任何一步失败都回登录页并带一句中文原因,不把服务器细节抛给用户。
function fail(origin: string, reason: string) {
  const url = new URL('/teacher/login', origin)
  url.searchParams.set('err', 'oidc')
  url.searchParams.set('msg', reason)
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const cfg = getOidcConfig(process.env, origin)
  if (!cfg) return fail(origin, '统一身份登录未配置')

  const sp = req.nextUrl.searchParams
  const err = sp.get('error')
  if (err) return fail(origin, `身份服务器拒绝了登录:${sp.get('error_description') ?? err}`)
  const code = sp.get('code')
  const state = sp.get('state')
  if (!code || !state) return fail(origin, '回调参数不完整')

  const session = await getSession()
  const pending = session.oidc
  // 一次性状态:用过即清,避免重放
  session.oidc = undefined
  if (!pending) {
    await session.save()
    return fail(origin, '登录状态已失效，请重新点登录')
  }
  if (pending.state !== state) {
    await session.save()
    return fail(origin, '登录状态不匹配，请重新点登录')
  }
  if (Date.now() - pending.startedAt > 10 * 60_000) {
    await session.save()
    return fail(origin, '登录超时，请重新点登录')
  }

  try {
    const token = await exchangeCode(cfg, { code, verifier: pending.verifier })
    const claims = decodeJwtPayload(token.id_token!)
    const bad = validateClaims(claims, cfg, pending.nonce, Date.now())
    if (bad || !claims) {
      await session.save()
      return fail(origin, bad ?? 'id_token 无效')
    }
    const user = toSessionUser(claims, cfg)
    session.user = user
    await session.save()
    // 建档(attempts / responses 的外键需要 users 行)
    await ensureUser(getDb(), user)
    console.log(`[auth] casdoor 登录成功 role=${user.role}`) // 不记 sub 与姓名(§9.5)
    return NextResponse.redirect(new URL(landingFor(user.role, pending.returnTo), origin))
  } catch (e) {
    await session.save()
    const msg = e instanceof OidcError ? e.message : '登录失败，请稍后再试'
    console.warn('[auth] casdoor 登录失败:', e instanceof Error ? e.message : e)
    return fail(origin, msg)
  }
}
