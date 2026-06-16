// AI-unavailability signalling.
//
// When a grading/perception provider can't run because it isn't configured (no
// API key) or isn't implemented, we throw a sentinel Error. The grading pipeline
// catches it (isUnavailable) and degrades gracefully — leaving the submission in
// the teacher queue with "AI 点评准备中" instead of marking it FAILED.
//
// The sentinel travels as a substring in the message ("未配置"/"未实现") so it
// survives being caught/rethrown/wrapped across the provider stack (message text
// is preserved where an `instanceof` check would not be). Create such errors ONLY
// via unavailable() so the matchable word is guaranteed and the contract stays in
// one place. Detect via isUnavailable().
//
// Match ONLY these precise sentinels — deliberately NOT loose words like
// "provider"/"api key", which appear in real upstream error bodies (e.g. a 401
// "Incorrect API key provided") that must surface as genuine failures.
const SENTINEL = /未配置|未实现/

// `detail` must already contain a sentinel word (e.g. "GEMINI_API_KEY 未配置",
// "感知 provider 未实现: openai"). Asserted in tests.
export function unavailable(detail: string): Error {
  return new Error(detail)
}

export function isUnavailable(message: string): boolean {
  return SENTINEL.test(message)
}
