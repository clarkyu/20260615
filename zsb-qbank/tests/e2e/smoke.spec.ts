import { test, expect } from '@playwright/test'

// 移动视口冒烟(需先起 dev server;CI 于 M2 接入)。
test.skip(!process.env.E2E_BASE_URL, '设 E2E_BASE_URL 后运行')

test('首页壳无横向滚动', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('专升本英语题库')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
