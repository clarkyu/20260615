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

// Push source translations onto already-imported official sets: a set is rebuilt
// from source only when the source now carries more Chinese 中心句 than the live set
// does, so it's idempotent + resumable (re-run until remaining hits 0) and a synced
// set is skipped. Bounded per call like importPack. `coverage` maps source →
// { id, withZh } for the live global sets; sets with no live row are left to import.
export async function refreshPack(
  prisma: PrismaClient,
  sets: PackSet[],
  coverage: Map<string, { id: number; withZh: number }>,
  maxChunks: number = MAX_CHUNKS_PER_CALL,
): Promise<{ imported: number; skipped: number; remaining: number }> {
  const sourceZh = (s: PackSet) => s.chunks.reduce((n, c) => n + (c.chinese ? 1 : 0), 0)
  const todo = sets.filter((s) => {
    const cov = s.meta.source ? coverage.get(s.meta.source) : undefined
    return cov !== undefined && sourceZh(s) > cov.withZh
  })
  const skipped = sets.length - todo.length

  let imported = 0
  let budget = 0
  for (const set of todo) {
    if (imported > 0 && budget + set.chunks.length > maxChunks) break
    const id = coverage.get(set.meta.source!)!.id
    await bank.replaceChunks(prisma, id, set.name, set.chunks, set.meta)
    imported++
    budget += set.chunks.length
  }
  return { imported, skipped, remaining: todo.length - imported }
}
