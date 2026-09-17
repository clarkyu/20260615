import { test, expect } from '@playwright/test'

// 写接口的两道门(硬约束之外,但 SPEC §9.5 明写):跨站写请求挡掉、按用户限速。
//
// 两道门都在 `src/middleware.ts` 里。纯函数各有表驱动用例(tests/http/origin.test.ts、
// client-key.test.ts),这里守的是**接线**:middleware 在**真正要部署的那个产物**上到底
// 有没有在把门。这正是 #492 暴露出来的那类口子 —— middleware 恰好又是 `next dev` /
// `next start` / `node .next/standalone/server.js` 三者可能不一样的地方,
// 而且它的限速计数靠模块级内存状态,那东西在不在、跨不跨请求,只有实跑才知道。
//
// 需要一个**生产构建**的服务(E2E_BASE_URL)。不需要数据库:两道门都在进业务逻辑之前。
test.skip(!process.env.E2E_BASE_URL, '设 E2E_BASE_URL 后运行')

/** 随便一条写接口。故意发不合法的体:两道门都在业务逻辑之前,进去了也只会 400 / 401,不写库。 */
const WRITE_PATH = '/api/attempts'

test.describe('写接口的两道门', () => {
  test('跨站写请求被挡在门外,同源的放进来', async ({ request, baseURL }) => {
    const evil = await request.post(WRITE_PATH, {
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      data: { paperId: 'x', mode: 'practice' },
      failOnStatusCode: false,
    })
    expect(evil.status(), '跨站写请求必须 403').toBe(403)

    // 对照组:同一条请求换成同源,必须**不是** 403 —— 否则上面那条 403 可能只是
    // 「这个接口对谁都 403」,断言就成了空的。走到 401(没登录)就说明已经进了处理函数。
    const same = await request.post(WRITE_PATH, {
      headers: { origin: baseURL ?? '', 'content-type': 'application/json' },
      data: { paperId: 'x', mode: 'practice' },
      failOnStatusCode: false,
    })
    expect(same.status(), '同源写请求不该被来源校验拦下').not.toBe(403)
  })

  test('读请求不受来源校验影响', async ({ request }) => {
    const res = await request.get('/api/health', { headers: { origin: 'https://evil.example' }, failOnStatusCode: false })
    expect(res.status()).toBe(200)
  })

  // 限速按「同一个客户端」分桶,而客户端就是会话 Cookie 的密文(见 lib/http/client-key.ts)。
  // 这里给每条用例发一个**独有的** zsb_session 值:middleware 只拿它分桶、不校验它,
  // 所以这既是「另一个客户端」的忠实模拟,又让用例各用各的桶、互不污染
  // (真拿本机 IP 那个桶来刷,会把同一轮里别的用例一起限掉)。
  const burst = async (
    request: import('@playwright/test').APIRequestContext,
    who: string,
    times: number,
    baseURL: string,
  ): Promise<number[]> => {
    const out: number[] = []
    for (let i = 0; i < times; i++) {
      const res = await request.post(WRITE_PATH, {
        headers: { origin: baseURL, 'content-type': 'application/json', cookie: `zsb_session=${who}` },
        data: { nope: true },
        failOnStatusCode: false,
      })
      out.push(res.status())
    }
    return out
  }

  test('写请求超过每分钟上限会被限速', async ({ request, baseURL }) => {
    const codes = await burst(request, `e2e-limit-${Date.now()}`, 130, baseURL ?? '')

    const firstLimited = codes.indexOf(429)
    expect(firstLimited, '限速必须真的生效;一直没有 429 说明 middleware 的计数没跨请求留住').toBeGreaterThan(0)
    // 上限是 120/分:前 120 条不该被限,第 121 条起该被限。
    expect(codes.slice(0, 120).filter((c) => c === 429), '额度用完之前不该限速').toHaveLength(0)
    expect(codes.slice(120).every((c) => c === 429), '额度用完之后每一条都该被限').toBe(true)
  })

  test('一个人被限速,不连累别人', async ({ request, baseURL }) => {
    // 一个学生的页面卡在循环里把自己刷爆了 —— 这不能让同班的其他人也交不了卷。
    const noisy = await burst(request, `e2e-noisy-${Date.now()}`, 125, baseURL ?? '')
    expect(noisy.at(-1), '先把这一个刷到限速').toBe(429)

    const other = await burst(request, `e2e-other-${Date.now()}`, 1, baseURL ?? '')
    expect(other[0], '另一个客户端必须照常').not.toBe(429)
  })
})
