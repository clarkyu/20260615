import { test, expect } from '@playwright/test'

// 教师端小题工具:「生成解析」在界面上点得到,而且点下去真能走通整条链路。
//
// `tests/config/route-reachability.test.ts` 那条静态扫描只证明「有代码引用这个接口」。
// 按钮渲染不出来、URL 拼错一个字、按钮被早退的 return 挡掉 —— 它都看不见。
// 所以这里点真按钮:POST → 入 ai_jobs → 轮询 /api/teacher/jobs/:id → 拿到结果说人话。
//
// 本地与 CI 都没配 AI,任务会以 ai_not_configured 收尾 —— 那**正好**是要验的:
// 整条线接通了,界面把失败原因说清楚了。真调 AI 的路径由 tests/ai/ai-jobs.test.ts 覆盖。
test.skip(!process.env.E2E_BASE_URL, '设 E2E_BASE_URL 后运行')

test('「生成解析」点得到,并把 AI 未配置说清楚', async ({ page }) => {
  await page.goto('/teacher/login')
  await page.getByRole('button', { name: '以教师身份登录（开发）' }).click()
  await page.waitForURL(/\/teacher$/)

  // 直接进整卷页,不从列表点进去:教师端是桌面优先(SPEC §8),那张宽表在 390px 视口下
  // 会有单元格盖住「查看整卷」链接 —— 那是教师端的取舍,不该让这条用例替它背锅。
  await page.goto('/teacher/papers/hubei-zsb-english-2025')

  const explain = page.getByRole('button', { name: /生成解析|重生成解析/ }).first()
  await expect(explain, '题库页每道小题都该有「生成解析」入口').toBeVisible()
  await explain.click()

  // 没配 AI 时 worker 立刻把任务判失败,界面要说出原因而不是一直转圈。
  await expect(page.getByText('失败：AI 未配置').first()).toBeVisible({ timeout: 30_000 })
})
