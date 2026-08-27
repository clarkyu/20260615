import { test, expect } from '@playwright/test'

// 模考闭环冒烟(M3):登录 → 开卷 → 倒计时可见 → 作答一空 → 交卷二次确认
// (列未作答题数)→ 成绩页分大题出分 → 未发布不见参考答案。
// 需要 AUTH_DEV_LOGIN=true 的运行中服务(CI 的 e2e 步骤;本地 pnpm dev 后设 E2E_BASE_URL)。
test.skip(!process.env.E2E_BASE_URL, '设 E2E_BASE_URL 后运行')

test('模拟考试:开卷到成绩闭环', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '以学生身份登录' }).click()

  const start = page.getByRole('button', { name: '模拟考试' }).first()
  await expect(start).toBeVisible()
  await start.click()
  await page.waitForURL(/\/play\//)

  // 服务端倒计时(120 分钟卷,形如 1:59:58)。
  await expect(page.getByText(/\d:\d\d:\d\d/)).toBeVisible()
  // 考试模式没有「对答案」。
  await expect(page.getByRole('button', { name: '对答案' })).toHaveCount(0)

  // 第一空作答(答案先落本地,再由队列同步)。
  await page.getByPlaceholder('输入英文').fill('biggest')
  await expect(page.getByText('已答 1/43')).toBeVisible()

  // 交卷:二次确认列出未作答题数。
  await page.getByRole('button', { name: '交卷', exact: true }).click()
  await expect(page.getByText('还有 42 题没作答')).toBeVisible()
  await page.getByRole('button', { name: '确认交卷' }).click()
  await page.waitForURL(/\/result\//)

  // 成绩页:总分 + 分大题;答对的 2 分计入。
  await expect(page.getByText('/ 100 分')).toBeVisible()
  await expect(page.getByText('短文填空')).toBeVisible()
  await expect(page.getByText('2 / 20 分')).toBeVisible()

  // 未发布的考试不下发参考答案(硬约束 1 延伸)。
  await page.getByRole('button', { name: '1', exact: true }).first().click()
  await expect(page.getByText('参考答案和解析等老师发布成绩后可见')).toBeVisible()
  await expect(page.getByText('参考答案:')).toHaveCount(0)
})
