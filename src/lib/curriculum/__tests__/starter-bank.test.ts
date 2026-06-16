import { describe, it, expect } from 'vitest'
import { starterSets, englishFlowSets } from '../starter-bank'
import { SEED_ITEMS } from '../seed'
import { ENGLISH_FLOW } from '../english-flow'
import { strandExists, isCefrBand, DOMAIN_IDS } from '../taxonomy'

describe('starter bank projection', () => {
  const sets = starterSets()

  it('produces one importable set per seed item', () => {
    expect(sets.length).toBe(SEED_ITEMS.length)
  })

  it('carries a stable, unique source key for idempotent re-import', () => {
    const sources = sets.map((s) => s.meta.source)
    expect(sources.every((s) => typeof s === 'string' && s.length > 0)).toBe(true)
    expect(new Set(sources).size).toBe(sources.length)
  })

  it('names every set and keeps its curriculum metadata valid', () => {
    for (const s of sets) {
      expect(s.name.length, s.meta.source ?? '').toBeGreaterThan(0)
      expect(isCefrBand(s.meta.cefr ?? ''), s.meta.source ?? '').toBe(true)
      expect(strandExists(s.meta.strand ?? ''), s.meta.source ?? '').toBe(true)
      expect(DOMAIN_IDS, s.meta.source ?? '').toContain(s.meta.domain)
    }
  })

  it('maps every spoken line to a recitable chunk', () => {
    for (const s of sets) {
      expect(s.chunks.length, s.meta.source ?? '').toBeGreaterThan(0)
      for (const c of s.chunks) expect(c.english.trim().length, s.meta.source ?? '').toBeGreaterThan(0)
    }
  })

  it('carries Chinese glosses through for shadowing lines', () => {
    const greetings = sets.find((s) => s.meta.source === 'en.spk.shadow.prea1.greetings')
    expect(greetings).toBeDefined()
    expect(greetings!.chunks[0].chinese).toBeTruthy()
  })
})

describe('English Flow 2000 projection', () => {
  const sets = englishFlowSets()

  it('batches all 2000 chunks into sets of 50', () => {
    expect(ENGLISH_FLOW.length).toBe(2000)
    expect(sets.length).toBe(40)
    expect(sets.reduce((n, s) => n + s.chunks.length, 0)).toBe(2000)
    expect(sets.every((s) => s.chunks.length === 50)).toBe(true)
  })

  it('keys each set with a unique source + valid metadata', () => {
    const sources = sets.map((s) => s.meta.source)
    expect(new Set(sources).size).toBe(sources.length)
    for (const s of sets) {
      expect(s.name.length).toBeGreaterThan(0)
      expect(strandExists(s.meta.strand ?? '')).toBe(true)
      expect(DOMAIN_IDS).toContain(s.meta.domain)
    }
  })

  it('maps phrase/means/example onto the 三段式 chunk', () => {
    for (const s of sets) {
      for (const c of s.chunks) {
        expect(c.english.trim().length).toBeGreaterThan(0)
        expect((c.meaningEn ?? '').trim().length).toBeGreaterThan(0)
        expect((c.exampleEn ?? '').trim().length).toBeGreaterThan(0)
      }
    }
  })
})
