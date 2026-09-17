// 写接口限速时「同一个客户端」怎么认(SPEC §9.5「接口按用户限速」)。
//
// 限速这道门放在 middleware 里(见 src/middleware.ts),而 middleware 跑在 edge 运行时:
// 拿不到解密后的会话,也**不该**为了限速去碰会话密钥。
//
// 好在会话 Cookie 的**密文**在一次登录内是稳定的 —— iron-session 只有 save() 时才换值,
// 而 save() 只发生在登录与登出。拿这段密文认「同一个人」就够了:
//   · 同一人两台设备算两个桶。这正是想要的:一台被刷爆不该连累另一台。
//   · 还没登录的写请求(开发登录、登出)退回客户端 IP。
//
// 桶键里不留 Cookie 原值:那是会话凭证,而桶键要在内存里待满一分钟。取个哈希只用来分桶。

/** FNV-1a 32 位。只用来分桶,不是密码学哈希,也不需要是。 */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * X-Forwarded-For 取**最后一段**。
 * RUNBOOK §4 的 nginx 用 `$proxy_add_x_forwarded_for`、Caddy 同样是追加,
 * 所以最后一段才是我们自己的反代看到的对端;第一段是客户端自己写进去的,可以随便伪造 ——
 * 拿第一段分桶等于让人一行请求头就换一个桶,限速就白做了。
 */
export function peerIp(forwardedFor: string | null): string | null {
  const parts = (forwardedFor ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length > 0 ? (parts[parts.length - 1] as string) : null
}

export interface ClientKeyInput {
  /** zsb_session 的值(密文),没登录时为 null */
  sessionCookie: string | null
  forwardedFor: string | null
}

/** 返回限速桶的键。前缀区分「按会话」与「按 IP」,免得两种键撞到一起。 */
export function clientKey(input: ClientKeyInput): string {
  if (input.sessionCookie) return `s:${fnv1a(input.sessionCookie)}`
  const ip = peerIp(input.forwardedFor)
  return ip ? `i:${fnv1a(ip)}` : 'anon'
}
