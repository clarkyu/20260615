import { defineConfig, devices } from '@playwright/test'

// Browser E2E (③ of the E2E plan). Deliberately NOT part of `npm test` / CI — it boots
// the real app via `next dev` (with OpenNext's local D1/R2 bindings) and drives a real
// Chromium, which is a smoke check rather than a fast, hermetic CI gate. Run locally:
//
//   npm run test:e2e
//
// The fake-media launch flags let getUserMedia/MediaRecorder work headless (for any
// recording-flow specs added later); the current specs cover the login critical path.
const PORT = 3123

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
      },
    },
  ],
  webServer: {
    command: `next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: { SESSION_SECRET: 'e2e-session-secret-at-least-32-characters-long', NODE_ENV: 'development' },
  },
})
