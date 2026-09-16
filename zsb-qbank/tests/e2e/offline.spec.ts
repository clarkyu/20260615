import { test, expect } from '@playwright/test'

// Service Worker 冒烟(SPEC §9.2)。验三件事:
//   1. SW 装得上、接管了页面;
//   2. **缓存里只有该有的东西** —— 这是安全线:手机可能共用、使用者是未成年人,
//      多缓存一条带姓名/任务的页面,就是把上一个人的数据留在了这台手机上;
//   3. 登出会清掉唯一那份带个人数据的缓存。
//
// 「拔网线后页面还能打开」没有写成断言:Chromium 的离线仿真对 SW 转发的导航请求
// 不稳定(同一个 setOffline(true) 下,有的导航失败、有的照样通到服务器),
// 写了只会得到一个时好时坏的用例。那条验收放到真机(飞行模式),见 docs/RUNBOOK.md §6。
//
// 需要 AUTH_DEV_LOGIN=true 的**生产构建**服务:SW 在 dev 下是关掉的。
test.skip(!process.env.E2E_BASE_URL, '设 E2E_BASE_URL 后运行')

/** 允许进 SW 缓存的路径:构建产物、断网兜底页、作答页/成绩页的壳、进行中的作答。 */
const ALLOWED = [/^\/_next\/static\//, /^\/offline$/, /^\/(play|result)\/[^/]+$/, /^\/api\/attempts\/[^/]+$/]

const swCacheEntries = (page: import('@playwright/test').Page) =>
  page.evaluate(async () => {
    const out: string[] = []
    for (const name of await caches.keys()) {
      const c = await caches.open(name)
      for (const req of await c.keys()) out.push(new URL(req.url).pathname)
    }
    return out
  })

async function loginAndPlay(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '以学生身份登录' }).click()
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 })
  const start = page.getByRole('button', { name: '开始练习' }).first()
  await expect(start).toBeVisible()
  await start.click()
  await page.waitForURL(/\/play\//)
  await expect(page.getByText(/已答 \d+\/\d+/)).toBeVisible()
  await page.waitForTimeout(1200) // 等壳预热与作答缓存落盘
}

test('SW 接管后,缓存里只有允许的东西', async ({ page }) => {
  await loginAndPlay(page)

  const entries = await swCacheEntries(page)
  const notAllowed = entries.filter((p) => !ALLOWED.some((re) => re.test(p)))
  expect(notAllowed, `不该被缓存的路径:${notAllowed.join(', ')}`).toEqual([])

  // 正面确认:该缓存的确实缓存了(断网接着做要靠这两条)。
  expect(entries.some((p) => /^\/play\/[^/]+$/.test(p)), '作答页的壳应已缓存').toBe(true)
  expect(entries.some((p) => /^\/api\/attempts\/[^/]+$/.test(p)), '进行中的作答应已缓存').toBe(true)
  // 断网兜底页必须是预缓存的,否则断网时它自己也打不开。
  expect(entries).toContain('/offline')

  // 反面确认:带个人信息的页面一条都不许在缓存里。
  for (const p of ['/', '/train', '/teacher', '/teacher/login', '/api/me', '/api/assignments']) {
    expect(entries, `${p} 不该进缓存`).not.toContain(p)
  }
})

test('登出后,带个人数据的缓存被清空', async ({ page }) => {
  await loginAndPlay(page)

  const before = await page.evaluate(async () => {
    const c = await caches.open('zsb-attempt-v1')
    return (await c.keys()).length
  })
  expect(before).toBeGreaterThan(0)

  // 登出打到 /api/auth/logout(POST)——SW 见到 /api/auth/* 就清掉带个人数据的缓存。
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }))
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          if (!(await caches.has('zsb-attempt-v1'))) return 0
          const c = await caches.open('zsb-attempt-v1')
          return (await c.keys()).length
        }),
      { timeout: 10_000 },
    )
    .toBe(0)
})

async function startExam(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '以学生身份登录' }).click()
  const start = page.getByRole('button', { name: '模拟考试' }).first()
  await expect(start).toBeVisible()
  await start.click()
  await page.waitForURL(/\/play\//)
}

/** 填一空并等它真的同步到服务端(顶栏 保存中 → 已保存)。 */
async function answerAndSync(page: import('@playwright/test').Page, word: string) {
  await page.getByPlaceholder('输入英文').fill(word)
  await expect(page.getByText('保存中')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('已保存')).toBeVisible({ timeout: 15_000 })
}

// 弱网下的作答安全(硬约束 7)。2026-09-16 的弱网预演实测过一次真丢分:
// 保存作答的 PUT 坏了、交卷的 POST 却是通的(网关抖动、请求体超限都会这样),
// 于是交卷照常成功,没传上去的作答因为「已交卷不能再保存」的 409 永远补不回来,按没答判 0。
//
// 这两条用例给 PUT 注入失败,所以要关掉 SW:生产构建下请求由 SW 代理,page.route 拦不到。
// 验的是应用自己的逻辑(交卷前必须确认作答已送达),与 SW 无关。
test.describe('同步没成功就不许交卷', () => {
  test.use({ serviceWorkers: 'block' })

  test('保存作答失败时交卷被拦下并说明原因;网络恢复后补传并交上', async ({ page }) => {
    await startExam(page)
    await answerAndSync(page, 'biggest')

    // 信号变差:只有保存作答的 PUT 坏掉,交卷的 POST 照常通。
    await page.route('**/api/attempts/*/responses', (r) =>
      r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"internal","message":"x"}}' }),
    )
    for (const w of ['for', 'started']) {
      await page.getByLabel('下一空').click()
      await page.getByPlaceholder('输入英文').fill(w)
    }
    await expect(page.getByText('保存中')).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: '交卷', exact: true }).click()
    await page.getByRole('button', { name: '确认交卷' }).click()

    // 没交成,而且告诉学生为什么 —— 交了那两空就永远补不回来了。
    await expect(page.getByText(/还有 \d+ 题没传到服务器/)).toBeVisible({ timeout: 20_000 })
    expect(page.url()).toContain('/play/')

    // 网络恢复:点重试要能把欠的补上去并交卷,不能把人永远困在这儿。
    await page.unroute('**/api/attempts/*/responses')
    await page.getByRole('button', { name: '重试' }).click()
    await page.waitForURL(/\/result\//, { timeout: 30_000 })
    // 三空全对,每空 2 分:证明断网期间写的两空一分没少。
    await expect(page.getByText('6 / 20 分')).toBeVisible()
  })

  test('只差用时埋点没传,不挡着交卷', async ({ page }) => {
    await startExam(page)
    await answerAndSync(page, 'biggest')

    // 作答已经全部送达,此后只有用时在涨;这时候 PUT 断掉。
    await page.route('**/api/attempts/*/responses', (r) => r.abort('failed'))
    await page.waitForTimeout(3500) // 攒一点用时,并让后台同步失败一次

    await page.getByRole('button', { name: '交卷', exact: true }).click()
    await page.getByRole('button', { name: '确认交卷' }).click()
    // 埋点是尽力而为的东西,坏了不能影响作答(同 attempt-store 里 persistTime 的原则)。
    await page.waitForURL(/\/result\//, { timeout: 30_000 })
    await expect(page.getByText('2 / 20 分')).toBeVisible()
  })
})

test('第一次开卷就把离线壳存下来(进页面那一刻 SW 还没接管)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '以学生身份登录' }).click()
  // 造出「第一次用这个应用」的状态:注销 SW + 清缓存再刷新,当前这个文档就没被接管。
  // 早先 warmShell() 见 controller 为空就直接不管了,于是第一次开的那份卷永远没有离线壳,
  // 断网一刷新只能弹到 /offline —— 而第一次用恰恰最容易乱点乱刷新。
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
    for (const k of await caches.keys()) await caches.delete(k)
  })
  await page.reload()
  await page.getByRole('button', { name: '模拟考试' }).first().click()
  await page.waitForURL(/\/play\//)

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          for (const name of await caches.keys()) {
            const c = await caches.open(name)
            for (const req of await c.keys()) if (/^\/play\/[^/]+$/.test(new URL(req.url).pathname)) return true
          }
          return false
        }),
      { timeout: 25_000, message: '作答页的壳最终必须进缓存,哪怕进页面时 SW 还没接管' },
    )
    .toBe(true)

  // 收尾:把这场考试交掉,免得后面的用例续答到它(同一个开发账号)。
  await page.getByRole('button', { name: '交卷', exact: true }).click()
  await page.getByRole('button', { name: '确认交卷' }).click()
  await page.waitForURL(/\/result\//, { timeout: 30_000 })
})
