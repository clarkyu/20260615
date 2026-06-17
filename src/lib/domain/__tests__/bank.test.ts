import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/repo/bank', () => ({
  createWithChunks: vi.fn().mockResolvedValue(1),
  replaceChunks: vi.fn().mockResolvedValue([]),
}))

import { importPack, refreshPack, type PackSet } from '../bank'
import type { PrismaClient } from '@prisma/client'

const prisma = {} as PrismaClient

// `zh` = how many of the n chunks carry a Chinese 中心句 (for refresh coverage tests).
function mk(source: string, n: number, zh = 0): PackSet {
  return {
    name: source,
    chunks: Array.from({ length: n }, (_, i) => ({ english: 'x', chinese: i < zh ? 'x中' : null, meaningEn: null, meaningZh: null, exampleEn: null, exampleZh: null })),
    meta: { cefr: null, strand: null, domain: null, tags: null, source, series: null },
  }
}

describe('importPack — bounded, resumable, idempotent', () => {
  it('skips sets whose source already exists', async () => {
    const r = await importPack(prisma, null, [mk('a', 5), mk('b', 5)], new Set(['a']))
    expect(r).toEqual({ imported: 1, skipped: 1, remaining: 0 })
  })

  it('imports a bounded batch and reports remaining', async () => {
    // budget 600 → a(300)+b(300) fit, stop before c
    const r = await importPack(prisma, null, [mk('a', 300), mk('b', 300), mk('c', 300)], new Set(), 600)
    expect(r.imported).toBe(2)
    expect(r.remaining).toBe(1)
  })

  it('always imports at least one set even if it exceeds the budget', async () => {
    const r = await importPack(prisma, null, [mk('big', 1000)], new Set(), 600)
    expect(r).toEqual({ imported: 1, skipped: 0, remaining: 0 })
  })
})

describe('refreshPack — pushes new translations, resumable + idempotent', () => {
  const cov = (m: Record<string, { id: number; withZh: number }>) => new Map(Object.entries(m))

  it('refreshes only sets whose source gained Chinese over the live set', async () => {
    const sets = [mk('a', 5, 5), mk('b', 5, 0)] // a now fully translated, b not
    const r = await refreshPack(prisma, sets, cov({ a: { id: 1, withZh: 0 }, b: { id: 2, withZh: 0 } }))
    expect(r).toEqual({ imported: 1, skipped: 1, remaining: 0 })
  })

  it('skips a set already in sync (source Chinese == live Chinese)', async () => {
    const r = await refreshPack(prisma, [mk('a', 5, 5)], cov({ a: { id: 1, withZh: 5 } }))
    expect(r).toEqual({ imported: 0, skipped: 1, remaining: 0 })
  })

  it('skips a set with no live row to update', async () => {
    const r = await refreshPack(prisma, [mk('a', 5, 5)], cov({}))
    expect(r).toEqual({ imported: 0, skipped: 1, remaining: 0 })
  })

  it('is bounded and reports remaining', async () => {
    const sets = [mk('a', 300, 300), mk('b', 300, 300), mk('c', 300, 300)]
    const r = await refreshPack(prisma, sets, cov({ a: { id: 1, withZh: 0 }, b: { id: 2, withZh: 0 }, c: { id: 3, withZh: 0 } }), 600)
    expect(r.imported).toBe(2)
    expect(r.remaining).toBe(1)
  })
})
