import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { devLoginEnabled, devLoginVerdict } from '@/lib/auth/dev-login'

// 开发登录是整套系统里权限最大的一个开关:开着就等于任何人一键成教师
// (全部参考答案、全班成绩、改分)。2026-09-17 实测:按 RUNBOOK 第一步
// `cp .env.example .env` 起一套生产 standalone 产物,教师登录页上公开挂着
// 「以教师身份登录(开发)」,`POST /api/auth/dev-login` 无凭证直接下发 role=teacher
// 的会话 —— 因为 `.env.example` 把 `AUTH_DEV_LOGIN=true` 当成了出厂默认(D83)。
//
// 这里守三件事:出厂默认是安全的那一侧;https 部署上强制关闭;本地与 CI 不受影响。

describe('开发登录的开关', () => {
  it('没开就是关的', () => {
    expect(devLoginEnabled({})).toBe(false)
    expect(devLoginEnabled({ AUTH_DEV_LOGIN: 'false' })).toBe(false)
    expect(devLoginEnabled({ AUTH_DEV_LOGIN: '1' })).toBe(false) // 只认字符串 true
  })

  it('本地 / CI(http)开着就是开着 —— CI 的 e2e 正是在生产构建上用它', () => {
    expect(devLoginEnabled({ AUTH_DEV_LOGIN: 'true' })).toBe(true)
    expect(devLoginEnabled({ AUTH_DEV_LOGIN: 'true', APP_ORIGIN: 'http://localhost:3000' })).toBe(true)
  })

  it('APP_ORIGIN 是 https(真实部署)时强制关闭,并说明理由', () => {
    const v = devLoginVerdict({ AUTH_DEV_LOGIN: 'true', APP_ORIGIN: 'https://zsb.example.com' })
    expect(v.enabled).toBe(false)
    expect(v.blocked).toBe(true)
    expect(v.reason).toContain('https')
  })

  it('多个 APP_ORIGIN 里只要有一个 https 就算真实部署', () => {
    expect(devLoginEnabled({ AUTH_DEV_LOGIN: 'true', APP_ORIGIN: 'http://localhost:3000, https://zsb.example.com' })).toBe(false)
  })

  it('没开的时候不算「被挡下」—— 那是正常状态,不该报错', () => {
    expect(devLoginVerdict({ APP_ORIGIN: 'https://zsb.example.com' })).toMatchObject({ enabled: false, blocked: false })
  })
})

describe('.env.example 的出厂默认必须是安全的那一侧', () => {
  const text = readFileSync(join(__dirname, '..', '..', '.env.example'), 'utf-8')
  const valueOf = (key: string) => text.split('\n').find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1).trim()

  it('扫描器确实读到了文件(否则下面的断言是空转)', () => {
    expect(text.length).toBeGreaterThan(200)
    expect(valueOf('DATABASE_URL')).toBeTruthy()
  })

  it('AUTH_DEV_LOGIN 出厂为 false —— RUNBOOK 第一步就是 cp .env.example .env', () => {
    expect(valueOf('AUTH_DEV_LOGIN')).toBe('false')
  })

  it('照抄出厂默认的 .env 不会把开发登录打开', () => {
    const env: Record<string, string> = {}
    for (const line of text.split('\n')) {
      if (!line || line.startsWith('#') || !line.includes('=')) continue
      const i = line.indexOf('=')
      env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
    expect(devLoginEnabled(env)).toBe(false)
  })
})
