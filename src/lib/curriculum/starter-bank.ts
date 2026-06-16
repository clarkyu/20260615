import type { ChunkInput } from '@/lib/bank'
import type { ChunkSetMeta } from '@/lib/repo/bank'
import { SEED_ITEMS } from './seed'
import { ENGLISH_FLOW } from './english-flow'

// Maps the hand-authored curriculum seed items into ready-to-import bank sets
// (题库句集). Each seed item becomes one set; every spoken line becomes a chunk
// (中心句 = the English line, 中文 = its zh gloss when present). Pronunciation
// scaffolding (IPA / minimal pairs) lives in the curriculum layer and is dropped
// in this pragmatic projection onto the 三段式 chunk shape — the lines themselves
// are fully recitable, so the set is immediately publishable + AI-gradable.
//
// `source` carries the stable seed id so re-importing is idempotent (a school
// never gets a second copy of the same starter set).

export interface StarterSet {
  meta: ChunkSetMeta
  name: string
  chunks: ChunkInput[]
}

function toChunk(line: { text: string; gloss?: { zh?: string; es?: string } }): ChunkInput {
  return {
    english: line.text,
    chinese: line.gloss?.zh ?? null,
    meaningEn: null,
    meaningZh: null,
    exampleEn: null,
    exampleZh: null,
  }
}

export function starterSets(): StarterSet[] {
  return SEED_ITEMS.map((item) => ({
    name: item.title,
    chunks: item.payload.lines.map(toChunk),
    meta: {
      cefr: item.cefr,
      strand: item.strand,
      domain: item.domain,
      tags: item.tags.join(','),
      source: item.id,
    },
  }))
}

// "2000 Essential English Chunks" (English Flow) → 40 sets of 50, in order.
// Each chunk's phrase/means/example map straight onto the 三段式 (english /
// meaningEn / exampleEn). `source` keys each set for idempotent re-import. Level
// is left blank (the source mixes A1–C2 without per-chunk tags).
const FLOW_BATCH = 50
export function englishFlowSets(): StarterSet[] {
  const sets: StarterSet[] = []
  for (let start = 0; start < ENGLISH_FLOW.length; start += FLOW_BATCH) {
    const slice = ENGLISH_FLOW.slice(start, start + FLOW_BATCH)
    const from = String(start + 1).padStart(4, '0')
    const to = String(start + slice.length).padStart(4, '0')
    sets.push({
      name: `English Flow · ${from}–${to}`,
      chunks: slice.map(([phrase, means, example]) => ({
        english: phrase,
        chinese: null,
        meaningEn: means,
        meaningZh: null,
        exampleEn: example,
        exampleZh: null,
      })),
      meta: {
        cefr: null,
        strand: 'english.speaking.shadowing',
        domain: 'general',
        tags: 'daily,conversational,english-flow',
        source: `englishflow:${from}-${to}`,
      },
    })
  }
  return sets
}
