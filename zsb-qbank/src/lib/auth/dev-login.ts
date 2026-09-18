// 开发登录的开关(SPEC §9.1:Casdoor 接入前的临时通道;CLAUDE.md 与 RUNBOOK 都写着「生产必须关闭」)。
//
// 2026-09-17 实测:按 RUNBOOK 第一步 `cp .env.example .env` 起一套生产 standalone 产物,
// 教师登录页上就公开挂着「以教师身份登录(开发)」,`POST /api/auth/dev-login` 不需要任何凭证
// 直接下发 role=teacher 的会话 —— **任何能访问站点的人都是教师**:全部参考答案、全班成绩、
// 改分权限。原因不是代码写错,是 `.env.example` 把 `AUTH_DEV_LOGIN=true` 当成了出厂默认,
// 而唯一的防线是运维照着表格改的时候别漏掉那一行(D83)。
//
// 三件事一起做:出厂默认改成 false;这里加一道按部署形态判断的硬门;开着时启动日志大声说。
//
// 硬门的判据是 `APP_ORIGIN` 是不是 https —— RUNBOOK 把 HTTPS 列为硬性要求(SW 与 Secure
// Cookie 都依赖它),所以「对外是 https」基本等价于「这是真实部署」。而本地开发与 CI 的
// e2e 都是 http://localhost,不受影响(CI 恰恰要在生产构建上用开发登录跑 e2e)。
// 用 NODE_ENV 判断则会把 CI 的 e2e 一并挡掉 —— 那条路是生产构建 + 开发登录。

export interface DevLoginVerdict {
  enabled: boolean
  /** 配置成开、但被部署形态挡下了:这是配置事故,要让人看见 */
  blocked: boolean
  reason: string
}

export function devLoginVerdict(env: Record<string, string | undefined> = process.env): DevLoginVerdict {
  const on = env.AUTH_DEV_LOGIN === 'true'
  if (!on) return { enabled: false, blocked: false, reason: '未开启' }

  const origins = (env.APP_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const https = origins.some((o) => o.toLowerCase().startsWith('https://'))
  if (https) {
    return {
      enabled: false,
      blocked: true,
      reason: `APP_ORIGIN 是 https(${origins.join(', ')}),这是真实部署:开发登录已被强制关闭。要用统一身份登录,或把 AUTH_DEV_LOGIN 设为 false 消除这条告警。`,
    }
  }
  return { enabled: true, blocked: false, reason: '已开启(非 https 部署)' }
}

/** 开发登录此刻是否真的可用。页面渲染按钮、接口放行,都只认它。 */
export function devLoginEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return devLoginVerdict(env).enabled
}
