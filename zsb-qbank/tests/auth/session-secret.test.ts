import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sessionSecretProblem } from '@/lib/auth/session'

// 会话密钥是整套鉴权的根。2026-09-17 实测:抄 `.env.example` 里那行出厂密钥,
// 用 iron-session 自己封一个 `{role:'admin'}` 的 Cookie,就拿到了
// `/api/me` → admin、`/api/teacher/grading/queue` → 200(含参考答案与评分要点)、
// `/api/teacher/classes` → 200 —— 没登录、没密码、没有任何按钮参与(D84)。
//
// 原来的校验只看长度 ≥32,而那句占位值恰好 35 字符,稳稳通过。

describe('会话密钥的可用性校验', () => {
  it('没配 / 太短 → 说清楚是哪种问题', () => {
    expect(sessionSecretProblem(undefined)).toContain('未配置')
    expect(sessionSecretProblem('')).toContain('未配置')
    expect(sessionSecretProblem('short')).toContain('过短')
    expect(sessionSecretProblem('x'.repeat(31))).toContain('过短')
  })

  it('长度够但是占位值 → 照样拒绝(原来这一关是过的)', () => {
    const shipped = 'please-change-me-please-change-me-32'
    expect(shipped.length).toBeGreaterThanOrEqual(32) // 长度这关它确实过得了
    expect(sessionSecretProblem(shipped)).toContain('占位值')
    expect(sessionSecretProblem('change-me-change-me-change-me-change-me')).toContain('占位值')
    expect(sessionSecretProblem('YOUR-SECRET-YOUR-SECRET-YOUR-SECRET-x')).toContain('占位值') // 大小写不敏感
    expect(sessionSecretProblem('example-example-example-example-abc')).toContain('占位值')
  })

  it('真随机串放行 —— 门不能把正常部署也挡住', () => {
    expect(sessionSecretProblem('kQ8f2Lm9pXzR4tVwY7bN3hJ6sD1gA5cE0uI+/aZ=')).toBeNull()
    // CI 用的那个值必须放行,否则这道门会把自己的验证链路堵死
    expect(sessionSecretProblem('ci-only-session-secret-0123456789abcdef')).toBeNull()
  })
})

describe('.env.example 不许出厂一个能用的密钥', () => {
  const text = readFileSync(join(__dirname, '..', '..', '.env.example'), 'utf-8')
  const shipped = text.split('\n').find((l) => l.startsWith('SESSION_SECRET='))?.slice('SESSION_SECRET='.length).trim()

  it('扫描器确实读到了那一行(否则下面是空转)', () => {
    expect(shipped).toBeDefined()
  })

  it('照抄出厂默认的 .env 起不来 —— 宁可部署时当场报错', () => {
    expect(sessionSecretProblem(shipped)).not.toBeNull()
  })
})
