import { defineConfig, devices } from '@playwright/test'

// 移动视口冒烟(SPEC §9.1):iPhone 13 与 Pixel 5 仿真。
// CI 只装 chromium,故两个 project 都显式覆盖 browserName(视口/UA/触摸仿真保留;
// WebKit 引擎差异靠真机验收覆盖——docs/DECISIONS.md D11)。
// workers: 1:模考流程同一开发账号会续答同一 attempt,串行避免两个 project 抢同一场考试。
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000' },
  projects: [
    { name: 'iphone-13', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'pixel-5', use: { ...devices['Pixel 5'], browserName: 'chromium' } },
  ],
})
