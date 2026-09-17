import { test, expect } from '@playwright/test'
import pg from 'pg'

// 考试计时边界(硬约束 6:计时以服务端 deadline_at 为准,客户端只显示;SPEC §9.5)。
//
// 纯函数边界已有表驱动用例(tests/grading/deadline-aggregate.test.ts),这里守的是**接线**:
// 客户端到底有没有照着服务端的时间走、到点有没有真的把卷交掉。2026-09-16 的计时预演走通了
// 这三条,但它们在 CI 里一条都没有,而其中「弱网下到点仍交得掉」正是最容易被改坏的一条。
//
// 需要 AUTH_DEV_LOGIN=true 的**生产构建**服务,以及能直连的 DATABASE_URL。
test.skip(!process.env.E2E_BASE_URL || !process.env.DATABASE_URL, '设 E2E_BASE_URL 与 DATABASE_URL 后运行')

const DB = process.env.DATABASE_URL ?? ''
const PAPER = 'hubei-zsb-english-2025'

async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: DB })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

/** 自由模考「未交的续答同一份」:清掉上一条用例留下的,免得这条一开始就在别人的考试里。 */
const clearOngoing = () =>
  withDb((c) =>
    c.query(
      `delete from attempts a using users u where u.id=a.user_id and u.casdoor_sub='dev-student' and a.status='in_progress'`,
    ),
  )

/**
 * 把这场考试的截止时间挪到 N 秒后。
 * 这是**前置条件**而不是绕过被测代码:老师给任务设一个近的截止时间时,
 * examDeadline() 得到的就是同样的短 deadline(min(now + 时长, 截止))。
 */
const shortenDeadline = (attemptId: string, seconds: number) =>
  withDb((c) => c.query(`update attempts set deadline_at = now() + ($2 || ' seconds')::interval where id=$1`, [attemptId, String(seconds)]))

const attemptStatus = (attemptId: string) =>
  withDb((c) => c.query('select status from attempts where id=$1', [attemptId]).then((r) => r.rows[0]?.status as string | undefined))

// 这几条用例一旦失败,会留下一份截止时间已过的「作答中」;后面的用例按「未交的续答同一份」
// 接过去就会连环红,真正的原因反而被埋掉。收尾清一下,让失败只停在它自己身上。
test.afterEach(clearOngoing)

/** 学生登录并开一场模考,返回 attemptId(此时还没进作答页)。 */
async function startExam(page: import('@playwright/test').Page): Promise<string> {
  await clearOngoing()
  await page.goto('/')
  await page.getByRole('button', { name: '以学生身份登录' }).click()
  await expect(page.getByRole('button', { name: '模拟考试' }).first()).toBeVisible()
  return page.evaluate(async (paperId) => {
    const r = await fetch('/api/attempts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paperId, mode: 'exam' }),
    })
    return (await r.json()).attemptId as string
  }, PAPER)
}

test('手机时钟快 30 分钟,倒计时仍按服务端走', async ({ page }) => {
  const attemptId = await startExam(page)
  // 设备时钟快 30 分钟。倒计时用 serverNow − Date.now() 的偏移校正,显示的应当还是真实剩余;
  // 若哪天改成直接信设备时钟,120 分钟的卷一进来就会显示 ~89 分钟。
  await page.clock.install({ time: new Date(Date.now() + 30 * 60_000) })
  await page.goto(`/play/${attemptId}`)
  await page.waitForSelector('input[placeholder="输入英文"]', { timeout: 20_000 })

  const shown = (await page.locator('header span.font-mono').first().innerText()).trim()
  const [h, m] = shown.split(':').map(Number)
  const mins = (h ?? 0) * 60 + (m ?? 0)
  expect(mins, `倒计时显示 ${shown};设备时钟快 30 分钟时若跟着错会是 ~89 分钟`).toBeGreaterThanOrEqual(115)
})

test('到点自动交卷', async ({ page }) => {
  const attemptId = await startExam(page)
  // 先在**正常时长**下把作答做完、确认真的同步上去了,再把截止时间挪近并刷新
  // (倒计时在进页面时读一次 deadline,刷新即按新的走)。
  // 这样「开页面 + 填空 + 等同步」就不用和 12 秒的倒计时赛跑 —— 机器一忙就会输,
  // 2026-09-17 整套跑时实际偶发过一次(单跑与重跑都过,原因就在这个窗口太窄)。
  await page.goto(`/play/${attemptId}`)
  await page.waitForSelector('input[placeholder="输入英文"]', { timeout: 20_000 })
  await page.getByPlaceholder('输入英文').fill('biggest')
  await expect(page.getByText('已保存')).toBeVisible({ timeout: 20_000 })

  await shortenDeadline(attemptId, 12)
  await page.reload()
  await page.waitForSelector('input[placeholder="输入英文"]', { timeout: 20_000 })

  await page.waitForURL(/\/result\//, { timeout: 40_000 })
  expect(await attemptStatus(attemptId)).not.toBe('in_progress')
  await expect(page.getByText('/ 100 分')).toBeVisible()
  await expect(page.getByText('2 / 20 分')).toBeVisible() // 到点前写的那一空算了分
})

// #486 给到点自动交卷开的 force 分支的回归点。
// 生产构建下 SW 会代理请求,page.route 拦不到,所以这一组关掉 SW;验的是应用逻辑,与 SW 无关。
test.describe('弱网下的到点自动交卷', () => {
  test.use({ serviceWorkers: 'block' })

  test('保存作答一直失败,到点也必须把卷交掉', async ({ page }) => {
    const attemptId = await startExam(page)
    // 同上:准备阶段不跟倒计时抢时间,作答同步好之后再把截止时间挪近并刷新。
    await page.goto(`/play/${attemptId}`)
    await page.waitForSelector('input[placeholder="输入英文"]', { timeout: 20_000 })
    await page.getByPlaceholder('输入英文').fill('biggest')
    await expect(page.getByText('已保存')).toBeVisible({ timeout: 20_000 })

    await shortenDeadline(attemptId, 14)
    await page.reload()
    await page.waitForSelector('input[placeholder="输入英文"]', { timeout: 20_000 })

    // 信号变差:此后保存作答一律失败。手动交卷会被拦下(见 offline.spec.ts),
    // 但**到点自动交卷不能被拦** —— 那时服务端过了 60 秒宽限本就不再收保存,
    // 拦着只会把学生困在一个走不掉的页面上,眼看着考试结束。
    await page.route('**/api/attempts/*/responses', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await page.getByLabel('下一空').click()
    await page.getByPlaceholder('输入英文').fill('for')

    await page.waitForURL(/\/result\//, { timeout: 40_000 })
    expect(await attemptStatus(attemptId)).not.toBe('in_progress')
  })
})
