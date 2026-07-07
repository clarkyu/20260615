// Single source of truth for environment configuration.
//
// OpenNext populates process.env from the Worker's vars + secrets (per request),
// so the scattered `process.env.X` reads across storage / session / email / ai
// are funnelled through here: typed getters, feature-presence flags, and a
// redacted diagnostics report. SECURITY: this module never logs or returns a
// secret VALUE — only the variable name and whether it is present.
import { logError, logWarn } from './log'

function env(key: string): string | undefined {
  const v = process.env[key]
  return v && v.trim() ? v : undefined
}

// Parse an env var as a finite number, or undefined (unset / non-numeric).
function numEnv(key: string): number | undefined {
  const v = env(key)
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

// Clamp an optional value into [lo, hi], falling back to `def` when unset. A bad env
// value can only ever land inside the safe range — never break grading.
function clampNum(n: number | undefined, def: number, lo: number, hi: number): number {
  return n === undefined ? Math.max(lo, Math.min(hi, def)) : Math.max(lo, Math.min(hi, n))
}

export const config = {
  appName: (): string => env('APP_NAME') ?? '你好！作业 Hi, Homework',
  appUrl: (): string | undefined => env('APP_URL'),
  sessionSecret: (): string | undefined => env('SESSION_SECRET'),
  adminEmail: (): string | undefined => env('ADMIN_EMAIL'),
  isProd: (): boolean => process.env.NODE_ENV === 'production',
  email: () => ({ from: env('EMAIL_FROM') ?? 'onboarding@resend.dev', apiKey: env('RESEND_API_KEY') }),
  r2: () => ({
    endpoint: env('R2_ENDPOINT'),
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    bucket: env('R2_BUCKET'),
  }),
  cronSecret: (): string | undefined => env('CRON_SECRET'),
  // Days to keep student recordings before the retention sweep deletes them. 0 (the
  // default, when unset/invalid) disables retention entirely — nothing is ever deleted.
  videoRetentionDays: (): number => { const n = Number(env('VIDEO_RETENTION_DAYS')); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0 },
  geminiKey: (): string | undefined => env('GEMINI_API_KEY'),
  geminiBaseUrl: (): string => env('GEMINI_BASE_URL') ?? 'https://generativelanguage.googleapis.com',
  // OpenAI powers GPT-4o (judge) + Whisper (transcription); Anthropic powers Claude (judge).
  openaiKey: (): string | undefined => env('OPENAI_API_KEY'),
  openaiBaseUrl: (): string => env('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1',
  anthropicKey: (): string | undefined => env('ANTHROPIC_API_KEY'),
  anthropicBaseUrl: (): string => env('ANTHROPIC_BASE_URL') ?? 'https://api.anthropic.com',
  // Generic read for dynamically-named provider vars (per-provider apiKey /
  // baseUrl / groupId env names), so config stays the single source of truth.
  env: (name: string): string | undefined => env(name),
  // AI grading calibration dials. These were empirical constants written into the
  // grading code ("AI-first, teacher by exception"); surfaced here so an operator can
  // tune them against the calibration signals (teacher overrides) without a redeploy.
  // Each is optional (falls back to the shipped default) and clamped to a safe range so
  // a bad value can never break grading. See docs/OPERATIONS.md.
  calibration: () => ({
    // AI self-confidence at/above which a clean (no anti-cheat flag) submission skips the
    // teacher queue and auto-approves. Higher = more caution (more goes to teachers).
    reviewConfidenceThreshold: clampNum(numEnv('REVIEW_CONFIDENCE_THRESHOLD'), 0.85, 0, 1),
    // Per-sentence shadow (逐句跟读) score = accuracy·w + completeness·(1−w). Weight on
    // accuracy; completeness takes the remainder, so the two always sum to 1.
    shadowAccuracyWeight: clampNum(numEnv('SHADOW_ACCURACY_WEIGHT'), 0.7, 0, 1),
    // A shadow submission auto-passes (skips the teacher) only if its overall score ≥
    // this AND its weakest sentence ≥ the min below. Both are 0..100.
    shadowAutoPassOverall: clampNum(numEnv('SHADOW_AUTOPASS_OVERALL'), 85, 0, 100),
    shadowAutoPassMin: clampNum(numEnv('SHADOW_AUTOPASS_MIN'), 60, 0, 100),
  }),
}

// Build stamp, baked in at `next build`. Deploy sets NEXT_PUBLIC_APP_VERSION to the
// git SHA; 'dev' when unset (local). MUST be a STATIC `process.env.NEXT_PUBLIC_*`
// access so Next inlines the literal into BOTH the client and server bundles — the
// auto-update gate and /api/version then compare the very same build's value. (The
// dynamic `env()` helper above is NOT inlined client-side, so it can't be used here.)
export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION || 'dev'

// Public-facing build id: the first 12 chars of the SHA, used anywhere the value is
// exposed to clients (the /api/version probe + the update gate). Avoids publishing the
// full 40-char commit SHA (a precise fingerprint) while staying a stable per-build
// value; 12 hex chars are collision-safe for the update gate's equality check. Both
// the gate and /api/version MUST use THIS same value so they still match within a build.
export const APP_VERSION_SHORT: string = APP_VERSION.slice(0, 12)

// ── feature-presence flags (do we have what a feature needs?) ─────────────────

export function storageConfigured(): boolean {
  const r = config.r2()
  return Boolean(r.endpoint && r.accessKeyId && r.secretAccessKey && r.bucket)
}

export function emailConfigured(): boolean {
  return Boolean(config.email().apiKey)
}

// Any one configured provider key means AI features can run — not just Gemini. (These
// are the distinct values of registry.ts PROVIDER_KEY_ENV; duplicated here so config
// keeps no upward dependency on the AI layer.)
const AI_PROVIDER_KEY_ENVS = ['GEMINI_API_KEY', 'QWEN_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'MINIMAX_API_KEY']

export function aiConfigured(): boolean {
  return AI_PROVIDER_KEY_ENVS.some((k) => Boolean(env(k)))
}

// 各 AI provider 平台 key 的「有无」清单(批阅诊断页用)。SECURITY:只报在/不在,
// 绝不返回值——与 startup report 同一条红线。
export function aiProviderPresence(): { env: string; present: boolean }[] {
  return AI_PROVIDER_KEY_ENVS.map((k) => ({ env: k, present: Boolean(env(k)) }))
}

// ── startup diagnostics (redacted — names + present/absent only) ──────────────

export interface ConfigReport {
  ok: boolean
  missingRequired: string[]
  features: Record<string, boolean>
}

// Required to even boot safely; everything else degrades to a disabled feature.
const REQUIRED = ['SESSION_SECRET', 'APP_URL']

export function configReport(): ConfigReport {
  const missingRequired = REQUIRED.filter((k) => !env(k))
  return {
    ok: missingRequired.length === 0,
    missingRequired,
    features: {
      storage: storageConfigured(),
      email: emailConfigured(),
      ai: aiConfigured(),
    },
  }
}

let validated = false

// Log a one-time redacted summary so a misconfigured deploy is visible ("why is AI
// grading not running?" → ai feature off). Never throws, never prints values.
export function validateConfigOnce(): void {
  if (validated) return
  validated = true
  const report = configReport()
  if (report.missingRequired.length > 0) {
    logError('config', 'missing required env', undefined, { missing: report.missingRequired.join(', ') })
  }
  const disabled = Object.entries(report.features).filter(([, on]) => !on).map(([name]) => name)
  if (disabled.length > 0) {
    logWarn('config', 'optional features disabled (env not set)', undefined, { disabled: disabled.join(', ') })
  }
}
