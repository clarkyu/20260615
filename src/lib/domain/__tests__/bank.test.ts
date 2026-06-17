import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/repo/bank', () => ({ createWithChunks: vi.fn().mockResolvedValue(1) }))

import { importPack, type PackSet } from '../bank'
import type { PrismaClient } from '@prisma/client'

const prisma = {} as PrismaClient

function mk(source: string, n: number): PackSet {
  return {
    name: source,
    chunks: Array.from({ length: n }, () => ({ english: 'x', chinese: null, meaningEn: null, meaningZh: null, exampleEn: null, exampleZh: null })),
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
