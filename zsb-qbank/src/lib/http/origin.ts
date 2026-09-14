// 写接口的来源校验(SPEC §9.5「写接口校验 Origin」):纯函数,middleware 与测试共用。
//
// 规则:
//   · 只校验会改数据的方法(非 GET / HEAD / OPTIONS)。
//   · 浏览器发跨站非简单请求一定带 Origin;带了就必须与本站同源(或在 APP_ORIGIN 白名单里)。
//   · 没有 Origin 的请求不是浏览器发的(curl、健康检查、服务端到服务端),不构成 CSRF,放行。
//   · 反向代理终止 TLS:本站 host 以 x-forwarded-host / x-forwarded-proto 为准,退回 host。

export interface OriginCheckInput {
  method: string
  origin: string | null
  host: string | null
  forwardedHost: string | null
  forwardedProto: string | null
  /** 逗号分隔的允许来源(APP_ORIGIN),如 https://zsb.example.com */
  allowed?: string | null
}

export function isWriteMethod(method: string): boolean {
  const m = method.toUpperCase()
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS'
}

function normalize(value: string): string {
  try {
    const u = new URL(value)
    return `${u.protocol}//${u.host}`.toLowerCase()
  } catch {
    return value.trim().toLowerCase().replace(/\/+$/, '')
  }
}

/** 本站自身的来源(取代理头,退回 host);拿不到 host 时为 null。 */
export function selfOrigin(input: Pick<OriginCheckInput, 'host' | 'forwardedHost' | 'forwardedProto'>): string | null {
  const host = (input.forwardedHost ?? input.host ?? '').split(',')[0]?.trim()
  if (!host) return null
  const proto = (input.forwardedProto ?? '').split(',')[0]?.trim() || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
  return `${proto}://${host}`.toLowerCase()
}

/** 允许放行返回 true;跨站写请求返回 false。 */
export function isAllowedOrigin(input: OriginCheckInput): boolean {
  if (!isWriteMethod(input.method)) return true
  if (!input.origin) return true // 非浏览器请求
  const origin = normalize(input.origin)
  const self = selfOrigin(input)
  if (self && origin === normalize(self)) return true
  const list = (input.allowed ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalize)
  return list.includes(origin)
}
