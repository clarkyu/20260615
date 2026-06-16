import { describe, it, expect } from 'vitest'
import {
  STRANDS, STRAND_IDS, strandExists, isCefrBand, CEFR_BANDS, CROSSWALK,
  DOMAIN_IDS, L1_CODES, PHONO_FEATURES,
} from '../taxonomy'
import { SEED_ITEMS } from '../seed'

describe('taxonomy internal consistency', () => {
  it('every strand parent exists', () => {
    for (const s of STRANDS) {
      if (s.parent) expect(STRAND_IDS).toContain(s.parent)
    }
  })

  it('crosswalk covers every CEFR band', () => {
    for (const band of CEFR_BANDS) expect(CROSSWALK[band]).toBeDefined()
  })
})

describe('seed items conform to the taxonomy', () => {
  it('have unique ids', () => {
    const ids = SEED_ITEMS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reference a valid strand, level, domain and assessment', () => {
    for (const item of SEED_ITEMS) {
      expect(strandExists(item.strand), item.id).toBe(true)
      expect(isCefrBand(item.cefr), item.id).toBe(true)
      expect(DOMAIN_IDS, item.id).toContain(item.domain)
      expect(['ai-speaking', 'ai-text', 'objective', 'ai-writing-rubric']).toContain(item.assessment)
      expect(item.canDo.length, item.id).toBeGreaterThan(0)
    }
  })

  it('use only known L1 codes in overlays', () => {
    for (const item of SEED_ITEMS) {
      for (const t of item.l1Trouble ?? []) expect(L1_CODES, `${item.id}:${t.l1}`).toContain(t.l1)
    }
  })

  it('tag speaking items with known phonological features', () => {
    const features = new Set<string>(PHONO_FEATURES)
    for (const item of SEED_ITEMS) {
      for (const tag of item.tags) expect(features, `${item.id}:${tag}`).toContain(tag)
    }
  })

  it('carry non-empty content + English-default instructions', () => {
    for (const item of SEED_ITEMS) {
      expect(item.payload.lines.length, item.id).toBeGreaterThan(0)
      expect(item.instructions.en.length, item.id).toBeGreaterThan(0)
    }
  })
})
