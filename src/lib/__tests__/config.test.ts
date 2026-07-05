import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { config, storageConfigured, emailConfigured, aiConfigured, configReport } from '../config'

const KEYS = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'RESEND_API_KEY', 'GEMINI_API_KEY', 'QWEN_API_KEY', 'VIDEO_RETENTION_DAYS', 'SESSION_SECRET', 'APP_URL', 'EMAIL_FROM', 'APP_NAME', 'REVIEW_CONFIDENCE_THRESHOLD', 'SHADOW_ACCURACY_WEIGHT', 'SHADOW_AUTOPASS_OVERALL', 'SHADOW_AUTOPASS_MIN']
const SAVED = new Map(KEYS.map((k) => [k, process.env[k]]))

beforeEach(() => { for (const k of KEYS) delete process.env[k] })
afterEach(() => { for (const k of KEYS) { const v = SAVED.get(k); if (v === undefined) delete process.env[k]; else process.env[k] = v } })

function setR2() {
  process.env.R2_ENDPOINT = 'https://x.r2.cloudflarestorage.com'
  process.env.R2_ACCESS_KEY_ID = 'id'
  process.env.R2_SECRET_ACCESS_KEY = 'secret'
  process.env.R2_BUCKET = 'bucket'
}

describe('feature flags', () => {
  it('storageConfigured needs all four R2 vars', () => {
    expect(storageConfigured()).toBe(false)
    setR2()
    expect(storageConfigured()).toBe(true)
    delete process.env.R2_BUCKET
    expect(storageConfigured()).toBe(false)
  })

  it('treats blank/whitespace env as absent', () => {
    process.env.GEMINI_API_KEY = '   '
    expect(aiConfigured()).toBe(false)
    process.env.GEMINI_API_KEY = 'k'
    expect(aiConfigured()).toBe(true)
  })

  it('aiConfigured is true for ANY provider key, not just Gemini', () => {
    expect(aiConfigured()).toBe(false)
    process.env.QWEN_API_KEY = 'q' // no Gemini key at all
    expect(aiConfigured()).toBe(true)
  })

  it('email flag tracks RESEND_API_KEY', () => {
    expect(emailConfigured()).toBe(false)
    process.env.RESEND_API_KEY = 're_x'
    expect(emailConfigured()).toBe(true)
  })
})

describe('getters + defaults', () => {
  it('falls back to defaults when unset', () => {
    expect(config.appName()).toBe('你好！作业 Hi, Homework')
    expect(config.email().from).toBe('onboarding@resend.dev')
    expect(config.geminiBaseUrl()).toBe('https://generativelanguage.googleapis.com')
    expect(config.appUrl()).toBeUndefined()
  })

  it('videoRetentionDays is disabled (0) by default, parses positive ints, rejects junk/negative', () => {
    expect(config.videoRetentionDays()).toBe(0) // unset → retention off
    process.env.VIDEO_RETENTION_DAYS = '90'
    expect(config.videoRetentionDays()).toBe(90)
    process.env.VIDEO_RETENTION_DAYS = '7.9'
    expect(config.videoRetentionDays()).toBe(7) // floored
    for (const junk of ['-5', '0', 'abc', '']) {
      process.env.VIDEO_RETENTION_DAYS = junk
      expect(config.videoRetentionDays()).toBe(0)
    }
  })

  it('honours overrides', () => {
    process.env.APP_NAME = 'My App'
    process.env.GEMINI_BASE_URL = 'https://proxy.example/'
    expect(config.appName()).toBe('My App')
    expect(config.geminiBaseUrl()).toBe('https://proxy.example/')
  })
})

describe('calibration dials', () => {
  it('falls back to the shipped defaults when unset', () => {
    expect(config.calibration()).toEqual({
      reviewConfidenceThreshold: 0.85,
      shadowAccuracyWeight: 0.7,
      shadowAutoPassOverall: 85,
      shadowAutoPassMin: 60,
    })
  })

  it('honours valid overrides', () => {
    process.env.REVIEW_CONFIDENCE_THRESHOLD = '0.9'
    process.env.SHADOW_ACCURACY_WEIGHT = '0.6'
    process.env.SHADOW_AUTOPASS_OVERALL = '80'
    process.env.SHADOW_AUTOPASS_MIN = '55'
    expect(config.calibration()).toEqual({
      reviewConfidenceThreshold: 0.9,
      shadowAccuracyWeight: 0.6,
      shadowAutoPassOverall: 80,
      shadowAutoPassMin: 55,
    })
  })

  it('clamps out-of-range values into a safe range (a bad env can never break grading)', () => {
    process.env.REVIEW_CONFIDENCE_THRESHOLD = '9' // >1 → clamp to 1
    process.env.SHADOW_ACCURACY_WEIGHT = '-2' // <0 → clamp to 0
    process.env.SHADOW_AUTOPASS_OVERALL = '250' // >100 → clamp to 100
    process.env.SHADOW_AUTOPASS_MIN = '-30' // <0 → clamp to 0
    expect(config.calibration()).toEqual({
      reviewConfidenceThreshold: 1,
      shadowAccuracyWeight: 0,
      shadowAutoPassOverall: 100,
      shadowAutoPassMin: 0,
    })
  })

  it('ignores non-numeric junk and keeps the default', () => {
    process.env.REVIEW_CONFIDENCE_THRESHOLD = 'abc'
    process.env.SHADOW_ACCURACY_WEIGHT = ''
    expect(config.calibration().reviewConfidenceThreshold).toBe(0.85)
    expect(config.calibration().shadowAccuracyWeight).toBe(0.7)
  })
})

describe('configReport', () => {
  it('flags missing required env and never exposes values', () => {
    const r = configReport()
    expect(r.ok).toBe(false)
    expect(r.missingRequired).toEqual(['SESSION_SECRET', 'APP_URL'])
    // Only names + booleans — no secret values anywhere in the report.
    expect(JSON.stringify(r)).not.toContain('secret')
    expect(Object.values(r.features).every((v) => typeof v === 'boolean')).toBe(true)
  })

  it('is ok once required env is present', () => {
    process.env.SESSION_SECRET = 's'.repeat(32)
    process.env.APP_URL = 'https://app.example'
    setR2()
    process.env.GEMINI_API_KEY = 'k'
    const r = configReport()
    expect(r.ok).toBe(true)
    expect(r.missingRequired).toEqual([])
    expect(r.features).toMatchObject({ storage: true, ai: true, email: false })
  })
})
