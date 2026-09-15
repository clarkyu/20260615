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
