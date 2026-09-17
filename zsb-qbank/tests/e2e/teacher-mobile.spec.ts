import { test, expect } from '@playwright/test'

// 教师端在手机视口下,表格里的操作链接得点得动。
//
// 教师端是桌面优先(SPEC §8),硬约束 5 那条 44px 也只管学生端 —— 但「点不动」不是排版
// 好不好看的问题。2026-09-17 实测:390px 下 `/teacher/papers` 的「查看整卷」「发布任务」
// **都点不中**(表格比视口宽 35px,`overflow-hidden` 把最后一列裁掉,命中点落在 <td> 上),
// 同一份页面在 1280px 下两个都正常。老师用手机看一眼班级情况是常事,这时候点不动。
//
// 只断言两件事,都拿真数据验:页面不横向溢出、点了真的跳过去。空表格的页面不进这个列表 ——
// 对着一张空表断言「没有横向溢出」是句废话(D72)。
test.skip(!process.env.E2E_BASE_URL, '设 E2E_BASE_URL 后运行')

async function loginAsTeacher(page: import('@playwright/test').Page) {
  await page.goto('/teacher/login')
  await page.getByRole('button', { name: '以教师身份登录（开发）' }).click()
  await page.waitForURL(/\/teacher$/)
}

// 种子库里这两页都有数据:试卷 1 份、小题 43 道。
for (const [name, path] of [
  ['试卷列表', '/teacher/papers'],
  ['题库', '/teacher/bank'],
] as const) {
  test(`${name}在手机视口下不横向溢出`, async ({ page }) => {
    await loginAsTeacher(page)
    await page.goto(path)
    const overflow = await page.evaluate(() => {
      const r = document.scrollingElement ?? document.documentElement
      return r.scrollWidth - r.clientWidth
    })
    expect(overflow, `${path} 横向溢出 ${overflow}px`).toBeLessThanOrEqual(1)
  })
}

test('试卷列表的「查看整卷」「发布任务」在手机上点得动', async ({ page }) => {
  await loginAsTeacher(page)

  await page.goto('/teacher/papers')
  await page.getByRole('link', { name: '查看整卷' }).first().click()
  await page.waitForURL(/\/teacher\/papers\/[^/]+$/)

  await page.goto('/teacher/papers')
  await page.getByRole('link', { name: '发布任务' }).first().click()
  await page.waitForURL(/\/teacher\/assignments/)
})
