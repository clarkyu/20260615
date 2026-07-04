import { describe, it, expect } from 'vitest'
import { phaseItemType, type ItemTypeFlags, type PhaseItemType } from '@/lib/phase-item-type'
import { isPollOnly } from '@/lib/domain/submit'

// The itemType discriminator must reproduce the pre-existing behaviour exactly. These
// tests pin (a) the mapping for the real phase shapes the authoring UI produces, (b)
// the precedence for every one of the 2^6 flag combinations — cross-checked against a
// reference that mirrors the SQL backfill in d1/migrations/0042_phase_item_type.sql —
// and (c) that `isPollOnly` (now defined via phaseItemType) still equals its old
// hand-written predicate.

const FLAG_KEYS = [
  'requireText',
  'requireAudio',
  'requireVideo',
  'requireHandwriting',
  'requireChoice',
  'requireFreeText',
] as const

// Reference precedence, mirroring the migration's three UPDATEs in order:
//   ① choice-only → objective   ② any audio/video → speech   ③ else → writing
function reference(f: ItemTypeFlags): PhaseItemType {
  const choiceOnly =
    !!f.requireChoice &&
    !f.requireFreeText &&
    !f.requireText &&
    !f.requireAudio &&
    !f.requireVideo &&
    !f.requireHandwriting
  if (choiceOnly) return 'objective'
  if (f.requireVideo || f.requireAudio) return 'speech'
  return 'writing'
}

// The old, pre-refactor definition of "pure poll" — the predicate isPollOnly used to
// inline. Kept here as the equivalence oracle.
function oldIsPollOnly(f: ItemTypeFlags): boolean {
  return (
    !!f.requireChoice &&
    !f.requireFreeText &&
    !f.requireText &&
    !f.requireVideo &&
    !f.requireAudio &&
    !f.requireHandwriting
  )
}

function combo(bits: number): ItemTypeFlags {
  const f: Record<string, boolean> = {}
  FLAG_KEYS.forEach((k, i) => {
    f[k] = Boolean(bits & (1 << i))
  })
  return f as ItemTypeFlags
}

describe('phaseItemType — named real-world phase shapes', () => {
  it('背诵 (recite text + eyes-closed video) → speech', () => {
    expect(phaseItemType({ requireText: true, requireVideo: true })).toBe('speech')
  })
  it('朗读 / 口语 (audio only) → speech', () => {
    expect(phaseItemType({ requireAudio: true })).toBe('speech')
  })
  it('单选题 / 投票 (choice only) → objective', () => {
    expect(phaseItemType({ requireChoice: true })).toBe('objective')
  })
  it('自由文本 (free text) → writing', () => {
    expect(phaseItemType({ requireFreeText: true })).toBe('writing')
  })
  it('手写 (handwriting only) → writing', () => {
    expect(phaseItemType({ requireHandwriting: true })).toBe('writing')
  })
  it('打字默写 (typed text only, no media) → writing', () => {
    expect(phaseItemType({ requireText: true })).toBe('writing')
  })
  it('choice + media (invalid combo) → speech (media wins, matches old routing)', () => {
    expect(phaseItemType({ requireChoice: true, requireVideo: true })).toBe('speech')
  })
  it('no flags at all → writing (never objective/speech)', () => {
    expect(phaseItemType({})).toBe('writing')
  })
})

describe('phaseItemType — exhaustive over all 64 flag combinations', () => {
  it('matches the backfill-precedence reference for every combination', () => {
    for (let bits = 0; bits < 1 << FLAG_KEYS.length; bits++) {
      const f = combo(bits)
      expect(phaseItemType(f), `flags=${JSON.stringify(f)}`).toBe(reference(f))
    }
  })

  it('only ever returns one of the three known values', () => {
    const seen = new Set<PhaseItemType>()
    for (let bits = 0; bits < 1 << FLAG_KEYS.length; bits++) seen.add(phaseItemType(combo(bits)))
    expect([...seen].sort()).toEqual(['objective', 'speech', 'writing'])
  })
})

describe('isPollOnly stays equivalent to its old inline definition', () => {
  it('isPollOnly(r) === (phaseItemType(r) === objective) === oldIsPollOnly(r) for all combos', () => {
    for (let bits = 0; bits < 1 << FLAG_KEYS.length; bits++) {
      const f = combo(bits)
      const r = {
        requireText: !!f.requireText,
        requireVideo: !!f.requireVideo,
        requireAudio: !!f.requireAudio,
        requireHandwriting: !!f.requireHandwriting,
        requireChoice: !!f.requireChoice,
        requireFreeText: !!f.requireFreeText,
      }
      expect(isPollOnly(r), `flags=${JSON.stringify(f)}`).toBe(oldIsPollOnly(f))
      expect(isPollOnly(r)).toBe(phaseItemType(f) === 'objective')
    }
  })
})
