import { AsyncLocalStorage } from 'node:async_hooks'

// Per-call override of provider API keys (teacher BYOK). When empty, providers fall
// back to the platform env key — so any flow that doesn't set keys is unchanged.
// Keyed by provider id (gemini/qwen/openai/whisper/claude/deepseek/minimax).
const store = new AsyncLocalStorage<Record<string, string>>()

export function withAiKeys<T>(keys: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  return Object.keys(keys).length > 0 ? store.run(keys, fn) : fn()
}

export function overrideKey(provider: string): string | undefined {
  return store.getStore()?.[provider]
}
