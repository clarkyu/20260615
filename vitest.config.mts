import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    // Unit + integration tests live under src/. The Playwright browser specs in e2e/
    // run via `npm run test:e2e`, never under vitest.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
