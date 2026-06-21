import { test, expect } from '@playwright/test'

// Real-browser smoke of the auth-gated critical path: a real Chromium drives the real
// app (next dev + local D1), submits the login server action, iron-session sets a
// cookie, and the role's home page renders. The submit→grade flow is covered
// exhaustively at the server level by the integration suites (①/②); this proves the
// UI + browser + server + DB + session actually work together end-to-end.
const PASSWORD = 'e2e-pass-123'

async function fillLogin(page: import('@playwright/test').Page, identifier: string, password: string) {
  await page.goto('/login')
  await page.selectOption('select[name="schoolId"]', { label: 'E2E 测试学校' })
  await page.fill('input[name="identifier"]', identifier)
  await page.fill('input[name="password"]', password)
  await page.click('button[type="submit"]')
}

test.describe('login (real browser)', () => {
  test('student signs in and lands on /student', async ({ page }) => {
    await fillLogin(page, '2025001', PASSWORD)
    await expect(page).toHaveURL(/\/student$/)
  })

  test('teacher signs in and lands on /dashboard', async ({ page }) => {
    await fillLogin(page, 'T1', PASSWORD)
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('wrong password stays on /login with a visible error', async ({ page }) => {
    await fillLogin(page, '2025001', 'wrong-password')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('alert')).toBeVisible()
  })
})
