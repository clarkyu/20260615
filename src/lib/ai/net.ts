// Shared upstream network timeouts for every AI provider. A stalled upstream must never
// pin a Worker isolate to the platform wall-clock limit, so every provider fetch carries
// one of these as an `AbortSignal.timeout(...)` — one policy, not a literal copied per provider.
export const UPSTREAM_TIMEOUT_MS = 180_000 // 3 min: a full generation / transcription call
export const POLL_TIMEOUT_MS = 60_000 // 1 min: a lightweight poll or metadata fetch (e.g. Gemini file status)
