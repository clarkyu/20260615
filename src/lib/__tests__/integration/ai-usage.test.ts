import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { logAiCall, spendSinceMicroUsd, spendSummary } from '@/lib/repo/ai-usage'

// The AI-spend ledger (#3) is an append-only "true account": one row per AI call, real
// tokens/cost, NEVER overwritten — the fix for Submission.costMicroUsd (single column,
// clobbered by the last write, failures unrecorded). These run the genuine SQL (create /
// scoped aggregate / count) through the real migrated table, so the CREATE TABLE DDL, the
// Prisma mapping, and the multi-tenant scope are all exercised for real.

describe('AI usage ledger (real SQL)', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('logAiCall appends one row per call and never overwrites (the true ledger)', async () => {
    const p = db.prisma
    await logAiCall(p, { submissionId: 1, schoolId: 7, kind: 'perception', model: 'gemini-3-flash-preview', inputTokens: 1000, outputTokens: 50, costMicroUsd: 500, ok: true })
    await logAiCall(p, { submissionId: 1, schoolId: 7, kind: 'judge', model: 'deepseek-chat', inputTokens: 200, outputTokens: 80, costMicroUsd: 20, ok: true })
    // Two rows for the SAME submission — a single-column store would have kept only the last.
    const rows = await p.aiUsageLog.findMany({ where: { submissionId: 1 } })
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.costMicroUsd).sort((a, b) => a - b)).toEqual([20, 500])
  })

  it('logAiCall clamps negative / fractional tokens and cost to a non-negative integer', async () => {
    const p = db.prisma
    await logAiCall(p, { submissionId: 2, schoolId: 7, kind: 'perception', model: 'm', inputTokens: -5, outputTokens: 3.7, costMicroUsd: 9.4, ok: false })
    const row = (await p.aiUsageLog.findFirst({ where: { submissionId: 2 } }))!
    expect(row.inputTokens).toBe(0)
    expect(row.outputTokens).toBe(4)
    expect(row.costMicroUsd).toBe(9)
    expect(row.ok).toBe(false)
  })

  it('spendSinceMicroUsd sums platform-wide from a cutoff (all schools — the breaker’s view)', async () => {
    const p = db.prisma
    const cutoff = new Date('2026-07-07T00:00:00Z')
    await p.aiUsageLog.create({ data: { kind: 'perception', model: 'm', costMicroUsd: 1_000, ok: true, createdAt: new Date('2020-01-01T00:00:00Z') } }) // before cutoff — excluded
    await p.aiUsageLog.create({ data: { schoolId: 1, kind: 'perception', model: 'm', costMicroUsd: 40_000_000, ok: true, createdAt: new Date('2026-07-07T06:00:00Z') } })
    await p.aiUsageLog.create({ data: { schoolId: 2, kind: 'judge', model: 'm', costMicroUsd: 20_000_000, ok: true, createdAt: new Date('2026-07-07T09:00:00Z') } })
    // Both schools counted (breaker guards the shared bill); the pre-cutoff row is not.
    expect(await spendSinceMicroUsd(p, cutoff)).toBe(60_000_000)
  })

  it('spendSummary scopes to one school, splits today vs month, and counts failures', async () => {
    const p = db.prisma
    const monthStart = new Date('2026-07-01T00:00:00Z')
    const todayStart = new Date('2026-07-07T00:00:00Z')
    // school 7: earlier this month + two today (one a $0 failure); school 8 today must NOT leak in.
    await p.aiUsageLog.create({ data: { schoolId: 7, kind: 'perception', model: 'm', costMicroUsd: 3_000_000, ok: true, createdAt: new Date('2026-07-03T00:00:00Z') } })
    await p.aiUsageLog.create({ data: { schoolId: 7, kind: 'judge', model: 'm', costMicroUsd: 1_000_000, ok: true, createdAt: new Date('2026-07-07T05:00:00Z') } })
    await p.aiUsageLog.create({ data: { schoolId: 7, kind: 'perception', model: 'm', costMicroUsd: 0, ok: false, createdAt: new Date('2026-07-07T05:30:00Z') } })
    await p.aiUsageLog.create({ data: { schoolId: 8, kind: 'perception', model: 'm', costMicroUsd: 9_000_000, ok: true, createdAt: new Date('2026-07-07T05:00:00Z') } })
    const s = await spendSummary(p, 7, todayStart, monthStart)
    expect(s.monthMicro).toBe(4_000_000) // 3M + 1M + 0 — school 7 only (school 8's 9M excluded)
    expect(s.todayMicro).toBe(1_000_000) // just today's successful judge
    expect(s.todayCalls).toBe(2) // today's judge + failed perception
    expect(s.todayFailed).toBe(1) // the $0 failure — proof "failures aren't billed"
  })
})
