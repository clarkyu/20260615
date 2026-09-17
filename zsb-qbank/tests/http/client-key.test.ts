import { describe, it, expect } from 'vitest'
import { clientKey, fnv1a, peerIp } from '@/lib/http/client-key'

// 写接口限速的分桶键(SPEC §9.5「接口按用户限速」)。
// 这里守的是两件会让限速白做的事:桶键别撞在一起,别让请求头能随手换一个桶。

describe('fnv1a', () => {
  it('同串同值、异串异值、定长可读', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'))
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'))
    expect(fnv1a('')).toMatch(/^[0-9a-z]+$/)
  })
  it('不回显原文 —— 桶键要在内存里待一分钟,不该是会话凭证本身', () => {
    const cookie = 'Fe26.2**deadbeef**sealed-session-token'
    expect(fnv1a(cookie)).not.toContain('sealed')
    expect(fnv1a(cookie).length).toBeLessThan(8)
  })
})

describe('peerIp', () => {
  it.each([
    ['1.2.3.4', '1.2.3.4'],
    // nginx $proxy_add_x_forwarded_for 是**追加**:最后一段才是反代看到的对端。
    ['9.9.9.9, 1.2.3.4', '1.2.3.4'],
    ['  9.9.9.9 ,  1.2.3.4  ', '1.2.3.4'],
    ['9.9.9.9, 10.0.0.1, 1.2.3.4', '1.2.3.4'],
    ['', null],
    [null, null],
  ])('%s → %s', (raw, want) => {
    expect(peerIp(raw)).toBe(want)
  })
})

describe('clientKey', () => {
  const noXff = { forwardedFor: null }

  it('登录了就按会话分桶', () => {
    expect(clientKey({ ...noXff, sessionCookie: 'aaa' })).toBe(clientKey({ ...noXff, sessionCookie: 'aaa' }))
    expect(clientKey({ ...noXff, sessionCookie: 'aaa' })).not.toBe(clientKey({ ...noXff, sessionCookie: 'bbb' }))
  })

  it('同一人两台设备是两个桶 —— 一台被刷爆不连累另一台', () => {
    // 两台设备各自登录,Cookie 密文不同(iron-session 每次 seal 的 IV 是随机的)。
    const phone = clientKey({ ...noXff, sessionCookie: 'sealed-A' })
    const pad = clientKey({ ...noXff, sessionCookie: 'sealed-B' })
    expect(phone).not.toBe(pad)
  })

  it('没登录退回客户端 IP', () => {
    expect(clientKey({ sessionCookie: null, forwardedFor: '1.2.3.4' })).toBe(clientKey({ sessionCookie: null, forwardedFor: '1.2.3.4' }))
    expect(clientKey({ sessionCookie: null, forwardedFor: '1.2.3.4' })).not.toBe(clientKey({ sessionCookie: null, forwardedFor: '5.6.7.8' }))
  })

  it('伪造 X-Forwarded-For 的前几段换不掉桶', () => {
    const real = clientKey({ sessionCookie: null, forwardedFor: '1.2.3.4' })
    // 攻击者在自己的请求里塞了一段,nginx 把真实对端追加在后面。
    expect(clientKey({ sessionCookie: null, forwardedFor: 'spoof-1, 1.2.3.4' })).toBe(real)
    expect(clientKey({ sessionCookie: null, forwardedFor: 'spoof-2, 1.2.3.4' })).toBe(real)
  })

  it('会话桶与 IP 桶不会互撞', () => {
    // 前缀在:哪怕哈希碰巧相同,`s:` 与 `i:` 也分得开。
    expect(clientKey({ ...noXff, sessionCookie: 'x' }).startsWith('s:')).toBe(true)
    expect(clientKey({ sessionCookie: null, forwardedFor: '1.1.1.1' }).startsWith('i:')).toBe(true)
  })

  it('既没会话也没 IP(本地直连)时有个兜底桶', () => {
    expect(clientKey({ sessionCookie: null, forwardedFor: null })).toBe('anon')
  })
})
