import type { ChunkInput } from '@/lib/bank'
import type { ChunkSetMeta } from '@/lib/repo/bank'
import { SEED_ITEMS } from './seed'

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
