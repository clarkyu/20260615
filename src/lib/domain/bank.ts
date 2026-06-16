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

export async function importPack(
  prisma: PrismaClient,
  scope: number | null,
  sets: PackSet[],
  existing: Set<string>,
): Promise<{ imported: number; skipped: number }> {
  let imported = 0
  let skipped = 0
  for (const set of sets) {
    if (set.meta.source && existing.has(set.meta.source)) {
      skipped++
      continue
    }
    await bank.createWithChunks(prisma, scope, set.name, set.chunks, set.meta)
    imported++
  }
  return { imported, skipped }
}
