import type { PrismaClient } from '@prisma/client'
import * as bank from '@/lib/repo/bank'
import type { ChunkSetMeta } from '@/lib/repo/bank'
import type { ChunkInput } from '@/lib/bank'

// Bank-pack import orchestration. A "pack" is a batch of named sets imported into
// one scope (a school, or the global/official pool when scope is null). Idempotent:
// a set whose `source` already exists in `existing` is skipped, so re-importing
// (or resuming a timed-out import) never duplicates. Shared by the starter pack,
// the curated chunk pack, and the generic super-admin pack importer.

export interface PackSet {
  name: string
  chunks: ChunkInput[]
  meta: ChunkSetMeta
}

// Per-call chunk budget. A single Worker request must not attempt an unbounded
// batch (CPU / subrequest / time limits → mid-run eviction with no transaction),
// so each invocation creates sets until ~this many chunks are inserted, then
// returns `remaining`. The caller re-invokes (idempotent by source) until
// remaining hits 0 — a bounded, resumable import instead of a long one-shot.
const MAX_CHUNKS_PER_CALL = 600

export async function importPack(
  prisma: PrismaClient,
  scope: number | null,
  sets: PackSet[],
  existing: Set<string>,
  maxChunks: number = MAX_CHUNKS_PER_CALL,
): Promise<{ imported: number; skipped: number; remaining: number }> {
  const todo = sets.filter((s) => !(s.meta.source && existing.has(s.meta.source)))
  const skipped = sets.length - todo.length

  let imported = 0
  let budget = 0
  for (const set of todo) {
    // Always import at least one set; otherwise stop before blowing the budget.
    if (imported > 0 && budget + set.chunks.length > maxChunks) break
    await bank.createWithChunks(prisma, scope, set.name, set.chunks, set.meta)
    imported++
    budget += set.chunks.length
  }
  return { imported, skipped, remaining: todo.length - imported }
}
