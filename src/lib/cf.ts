import { getCloudflareContext } from '@opennextjs/cloudflare'
import { logError } from './log'

// Run work *after* the response is sent, using the Worker execution context's
// waitUntil when available (so e.g. auto-grading doesn't make a student wait on
// the AI). Outside Workers (local dev) it falls back to a best-effort kick-off.
export async function runAfterResponse(work: () => Promise<unknown>): Promise<void> {
  try {
    const { ctx } = await getCloudflareContext({ async: true })
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(Promise.resolve().then(work).catch((e) => logError('runAfterResponse', 'background work failed', e)))
      return
    }
  } catch {
    // No Cloudflare context (local dev / tests) — fall through to best-effort.
  }
  void Promise.resolve().then(work).catch((e) => logError('runAfterResponse', 'background work failed', e))
}
