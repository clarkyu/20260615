import { test, expect, type Browser, type Page } from '@playwright/test'

// 同一个学生两台设备同时作答(微信里开一个、浏览器里又开一个;或者换了手机接着做)。
// 2026-09-16 的双设备预演在这里抓到一次真丢分:服务端按 `clientUpdatedAt` 新者胜合并,
// 而这个时间戳原本直接取自**设备时钟** —— 时钟快的那台先写的旧答案,会盖掉学生后来改对的答案,
// 屏幕上是对的、交上去是错的,谁都不知道。硬约束 6 早就为倒计时立过同一条规矩:设备时钟只能显示。
//
// 这个 spec 不碰数据库:要看「服务端到底存了什么」,就再开一台全新设备(本地库是空的)去读。
test.skip(!process.env.E2E_BASE_URL, '设 E2E_BASE_URL 后运行')

const PAPER = 'hubei-zsb-english-2025'

/** 开一台「设备」:独立上下文 = 独立 IndexedDB,但登录的是同一个学生。 */
async function newDevice(browser: Browser, opts: { skewMs?: number } = {}): Promise<Page> {
  // 生产构建下 SW 会代理请求;这里验的是应用逻辑,关掉它让行为可预期。
  const ctx = await browser.newContext({ serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await page.goto('/')
  await page.getByRole('button', { name: '以学生身份登录' }).click()
  await expect(page.getByRole('button', { name: '模拟考试' }).first()).toBeVisible()
  if (opts.skewMs) await page.clock.install({ time: new Date(Date.now() + opts.skewMs) })
  return page
}

const startExam = (page: Page) =>
  page.evaluate(async (paperId) => {
    const r = await fetch('/api/attempts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paperId, mode: 'exam' }),
    })
    return (await r.json()).attemptId as string
  }, PAPER)

async function openPlay(page: Page, attemptId: string) {
  await page.goto(`/play/${attemptId}`)
  await page.waitForSelector('input[placeholder="输入英文"]', { timeout: 20_000 })
}

/** 填当前这一空,并等它真的同步上去(顶栏 保存中 → 已保存)。 */
async function writeAndSync(page: Page, word: string) {
  await page.getByPlaceholder('输入英文').fill(word)
  await expect(page.getByText('保存中')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('已保存')).toBeVisible({ timeout: 20_000 })
}

/** 从一台干净设备读服务端存下来的第 1 空。 */
async function firstBlankOnServer(page: Page, attemptId: string): Promise<string | undefined> {
  return page.evaluate(async (id) => {
    const r = await fetch(`/api/attempts/${id}`)
    const j = await r.json()
    const first = j.paper?.sections?.[0]?.groups?.[0]?.items?.[0]
    const row = (j.responses ?? []).find((x: { itemId: string }) => x.itemId === first?.id)
    return row?.answer?.value as string | undefined
  }, attemptId)
}

const submitViaApi = (page: Page, attemptId: string) =>
  page.evaluate((id) => fetch(`/api/attempts/${id}/submit`, { method: 'POST' }).then(() => undefined), attemptId)

test('时钟快的那台设备,不能用旧答案盖掉学生后来改对的', async ({ browser }) => {
  const A = await newDevice(browser, { skewMs: 10 * 60_000 }) // A 的时钟快 10 分钟
  const attemptId = await startExam(A)
  const B = await newDevice(browser)
  await openPlay(A, attemptId)
  await openPlay(B, attemptId)

  await writeAndSync(A, 'zzz-wrong') // 时钟快的设备先写了个错的
  await writeAndSync(B, 'biggest') // 学生换到另一台,把它改对了

  // 用一台全新设备去读服务端:它本地库是空的,看到的就是服务端那份。
  const C = await newDevice(browser)
  expect(await firstBlankOnServer(C, attemptId), '学生最后改对的那个必须胜出').toBe('biggest')

  await submitViaApi(C, attemptId) // 收尾:别把未交的卷留给后面的用例
})

test('一台交了卷,另一台还在写:当场说清楚,而不是让学生以为自己网不好', async ({ browser }) => {
  const A = await newDevice(browser)
  const attemptId = await startExam(A)
  const B = await newDevice(browser)
  await openPlay(A, attemptId)
  await openPlay(B, attemptId)

  await writeAndSync(A, 'biggest')
  await A.getByRole('button', { name: '交卷', exact: true }).click()
  await A.getByRole('button', { name: '确认交卷' }).click()
  await A.waitForURL(/\/result\//, { timeout: 30_000 })

  // B 毫不知情,继续写。此后保存一律 409 —— 重试一万次也没用,不能再说「等网络好点重试」。
  await B.getByLabel('下一空').click()
  await B.getByPlaceholder('输入英文').fill('for')

  const banner = B.locator('header a[href^="/result/"]')
  await expect(banner, '应当当场告诉学生这份卷已经交过了').toContainText('交过了', { timeout: 20_000 })

  await B.getByRole('button', { name: '交卷', exact: true }).click()
  await B.getByRole('button', { name: '确认交卷' }).click()
  await B.waitForURL(/\/result\//, { timeout: 30_000 })
  await expect(B.getByText(/还有 \d+ 题没传到服务器/), '不该再拿网络问题搪塞').toHaveCount(0)
})
