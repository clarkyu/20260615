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
    // The integration harness builds the migrated SQLite schema once per worker (then
    // clones it per test). That one-time replay of all D1 migrations can approach the
    // default 10s hook budget on a loaded CI runner — give setup/teardown headroom so a
    // slow-but-correct build isn't reported as a flaky "Hook timed out" failure.
    hookTimeout: 30000,
    // Unit + integration tests live under src/. The Playwright browser specs in e2e/
    // run via `npm run test:e2e`, never under vitest.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
