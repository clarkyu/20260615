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
}

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
