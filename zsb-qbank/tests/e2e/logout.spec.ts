import { test, expect } from '@playwright/test'

// 登出(SPEC §9.1)。
//
// 这条用例存在的理由:在它之前,`/api/auth/logout` 有接口、SW 有「见到 /api/auth/* 就清掉
// 带个人数据的缓存」的逻辑、tests/e2e/offline.spec.ts 还专门验过那条清理 —— 但**产品里
// 没有任何界面调用它**。三样东西都对,合起来是个登不出去的应用:共用手机、机房电脑上,
// 上一个人的会话会一直挂着。所以这里从「界面上点得到」验起,而不是从接口验起。
test.skip(!process.env.E2E_BASE_URL, '设 E2E_BASE_URL 后运行')

const loggedIn = (page: import('@playwright/test').Page) => page.evaluate(async () => (await (await fetch('/api/me')).json())?.user != null)

test('学生:首页点得到「退出登录」,点完会话真的没了', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '以学生身份登录' }).click()
  await expect(page.getByRole('button', { name: '开始练习' }).first()).toBeVisible()
  expect(await loggedIn(page)).toBe(true)

  const logout = page.getByRole('button', { name: '退出登录' })
  await expect(logout).toBeVisible()
  await logout.click()

  // 回到未登录的首页:不只是界面变了,服务端那份会话也得没了 ——
  // 只把按钮藏起来的「退出」在共用手机上等于没退。
  await expect(page.getByText('请先登录')).toBeVisible()
  expect(await loggedIn(page)).toBe(false)
})

test('教师:顶栏点得到「退出」,点完回登录页且没有会话', async ({ page }) => {
  await page.goto('/teacher/login')
  await page.getByRole('button', { name: '以教师身份登录（开发）' }).click()
  await page.waitForURL(/\/teacher$/)

  await page.getByRole('button', { name: '退出' }).click()
  await page.waitForURL(/\/teacher\/login/)
  expect(await loggedIn(page)).toBe(false)
  // 退出后顶栏不该再留着上一个人的名字和退出按钮
  await expect(page.getByRole('button', { name: '退出' })).toHaveCount(0)
})
