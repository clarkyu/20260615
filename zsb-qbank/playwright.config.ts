import { defineConfig, devices } from '@playwright/test'

// 移动视口冒烟(SPEC §9.1):iPhone 13 与 Pixel 5 仿真。
export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000' },
  projects: [
    { name: 'iphone-13', use: { ...devices['iPhone 13'] } },
    { name: 'pixel-5', use: { ...devices['Pixel 5'] } },
  ],
})
