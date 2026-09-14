import { describe, it, expect } from 'vitest'
import { isAllowedOrigin, isWriteMethod, selfOrigin } from '@/lib/http/origin'

// 写接口来源校验(SPEC §9.5):跨站写请求拦截,读请求与非浏览器请求放行。

const base = { host: 'zsb.example.com', forwardedHost: null, forwardedProto: null, allowed: null }

describe('isWriteMethod', () => {
  it.each([
    ['GET', false],
    ['head', false],
    ['OPTIONS', false],
    ['POST', true],
    ['put', true],
    ['PATCH', true],
    ['DELETE', true],
  ])('%s → %s', (m, want) => {
    expect(isWriteMethod(m)).toBe(want)
  })
})

describe('selfOrigin', () => {
  it('取代理头,退回 host;本地默认 http,其它默认 https', () => {
    expect(selfOrigin({ host: 'zsb.example.com', forwardedHost: null, forwardedProto: null })).toBe('https://zsb.example.com')
    expect(selfOrigin({ host: 'localhost:3000', forwardedHost: null, forwardedProto: null })).toBe('http://localhost:3000')
    expect(selfOrigin({ host: '127.0.0.1:3000', forwardedHost: 'zsb.example.com', forwardedProto: 'https' })).toBe('https://zsb.example.com')
    expect(selfOrigin({ host: null, forwardedHost: 'a.com, b.com', forwardedProto: 'https, http' })).toBe('https://a.com')
    expect(selfOrigin({ host: null, forwardedHost: null, forwardedProto: null })).toBeNull()
  })
})

describe('isAllowedOrigin', () => {
  it('读请求一律放行(即使跨站)', () => {
    expect(isAllowedOrigin({ ...base, method: 'GET', origin: 'https://evil.com' })).toBe(true)
  })
  it('同源写请求放行;反代场景按 x-forwarded-host 判', () => {
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: 'https://zsb.example.com' })).toBe(true)
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: 'https://zsb.example.com/' })).toBe(true)
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: 'HTTPS://ZSB.EXAMPLE.COM' })).toBe(true)
    expect(isAllowedOrigin({ method: 'PUT', origin: 'https://zsb.example.com', host: '127.0.0.1:3000', forwardedHost: 'zsb.example.com', forwardedProto: 'https', allowed: null })).toBe(true)
    expect(isAllowedOrigin({ method: 'POST', origin: 'http://localhost:3000', host: 'localhost:3000', forwardedHost: null, forwardedProto: null, allowed: null })).toBe(true)
  })
  it('跨站写请求拦截', () => {
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: 'https://evil.com' })).toBe(false)
    expect(isAllowedOrigin({ ...base, method: 'DELETE', origin: 'https://zsb.example.com.evil.com' })).toBe(false)
    // 同域名不同协议也算跨站(降级攻击)
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: 'http://zsb.example.com' })).toBe(false)
  })
  it('APP_ORIGIN 白名单可放行额外来源', () => {
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: 'https://zsb.other.cn', allowed: 'https://zsb.other.cn, https://x.cn' })).toBe(true)
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: 'https://nope.cn', allowed: 'https://zsb.other.cn' })).toBe(false)
  })
  it('没有 Origin(非浏览器)放行', () => {
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: null })).toBe(true)
  })
  it('拿不到 host 时只认白名单', () => {
    expect(isAllowedOrigin({ method: 'POST', origin: 'https://zsb.example.com', host: null, forwardedHost: null, forwardedProto: null, allowed: null })).toBe(false)
    expect(isAllowedOrigin({ method: 'POST', origin: 'https://zsb.example.com', host: null, forwardedHost: null, forwardedProto: null, allowed: 'https://zsb.example.com' })).toBe(true)
  })
})
