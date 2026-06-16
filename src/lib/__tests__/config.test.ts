import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { config, storageConfigured, emailConfigured, aiConfigured, configReport } from '../config'

const KEYS = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'RESEND_API_KEY', 'GEMINI_API_KEY', 'SESSION_SECRET', 'APP_URL', 'EMAIL_FROM', 'APP_NAME']
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

  it('email flag tracks RESEND_API_KEY', () => {
    expect(emailConfigured()).toBe(false)
    process.env.RESEND_API_KEY = 're_x'
    expect(emailConfigured()).toBe(true)
  })
})

describe('getters + defaults', () => {
  it('falls back to defaults when unset', () => {
    expect(config.appName()).toBe('英语背诵作业')
    expect(config.email().from).toBe('onboarding@resend.dev')
    expect(config.geminiBaseUrl()).toBe('https://generativelanguage.googleapis.com')
    expect(config.appUrl()).toBeUndefined()
  })

  it('honours overrides', () => {
    process.env.APP_NAME = 'My App'
    process.env.GEMINI_BASE_URL = 'https://proxy.example/'
    expect(config.appName()).toBe('My App')
    expect(config.geminiBaseUrl()).toBe('https://proxy.example/')
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
