import type { PrismaClient } from '@prisma/client'
import type { ChunkInput } from '@/lib/bank'

// Tenant-scoped data access for the item bank (题库：句集 + 三段式句子). The
// chunk-row mapping lives here so create and replace stay identical.

export interface ChunkSetMeta {
  cefr: string | null
  strand: string | null
  domain: string | null
  tags: string | null
  source: string | null
}

function chunkRows(setId: number, chunks: ChunkInput[]) {
  return chunks.map((c, i) => ({
    chunkSetId: setId,
    order: i + 1,
    english: c.english,
    chinese: c.chinese,
    meaningEn: c.meaningEn,
    meaningZh: c.meaningZh,
    exampleEn: c.exampleEn,
    exampleZh: c.exampleZh,
  }))
}

export function findForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.chunkSet.findFirst({ where: { id, schoolId: schoolId ?? -1 } })
}

// Stable `source` keys already present in a school — lets the starter-pack import
// skip sets it has imported before (idempotent re-import).
export async function importedSources(prisma: PrismaClient, schoolId: number): Promise<Set<string>> {
  const rows = await prisma.chunkSet.findMany({
    where: { schoolId, source: { not: null } },
    select: { source: true },
  })
  return new Set(rows.map((r) => r.source).filter((s): s is string => s !== null))
}

export interface BankFilters {
  cefr?: string
  strand?: string
  domain?: string
}

// Set list for the bank index — name, video presence, chunk count, level/skill
// for badges, newest first. Optional curriculum filters (each ANDed when present).
export function listForSchool(prisma: PrismaClient, schoolId: number | null | undefined, filters?: BankFilters) {
  return prisma.chunkSet.findMany({
    where: {
      schoolId: schoolId ?? -1,
      ...(filters?.cefr ? { cefr: filters.cefr } : {}),
      ...(filters?.strand ? { strand: filters.strand } : {}),
      ...(filters?.domain ? { domain: filters.domain } : {}),
    },
    select: { id: true, name: true, shadowVideoKey: true, cefr: true, strand: true, _count: { select: { chunks: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

// A set's header summary (no chunk rows) — for the publish-from-set screen.
export function findSummaryForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.chunkSet.findFirst({
    where: { id, schoolId: schoolId ?? -1 },
    select: { id: true, name: true, shadowVideoKey: true, _count: { select: { chunks: true } } },
  })
}

// The set plus its ordered chunks — used when publishing an assignment from a set.
export function findWithChunksForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.chunkSet.findFirst({
    where: { id, schoolId: schoolId ?? -1 },
    include: { chunks: { orderBy: { order: 'asc' } } },
  })
}

// Standalone create (not nested in $transaction) so D1 can resolve the new set id
// for the chunk inserts. Returns the new set id.
export async function createWithChunks(prisma: PrismaClient, schoolId: number, name: string, chunks: ChunkInput[], meta?: ChunkSetMeta): Promise<number> {
  const set = await prisma.chunkSet.create({ data: { schoolId, name, ...meta } })
  await prisma.chunk.createMany({ data: chunkRows(set.id, chunks) })
  return set.id
}

// Rename + replace every chunk in one batch ($transaction of statements is fine on
// D1 — only interactive transactions are unavailable).
export function replaceChunks(prisma: PrismaClient, id: number, name: string, chunks: ChunkInput[], meta?: ChunkSetMeta) {
  return prisma.$transaction([
    prisma.chunkSet.update({ where: { id }, data: { name, ...meta } }),
    prisma.chunk.deleteMany({ where: { chunkSetId: id } }),
    prisma.chunk.createMany({ data: chunkRows(id, chunks) }),
  ])
}

export function setVideoKey(prisma: PrismaClient, id: number, key: string) {
  return prisma.chunkSet.update({ where: { id }, data: { shadowVideoKey: key } })
}

export async function deleteForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined): Promise<boolean> {
  const found = await prisma.chunkSet.findFirst({ where: { id, schoolId: schoolId ?? -1 }, select: { id: true } })
  if (!found) return false
  await prisma.chunkSet.delete({ where: { id } })
  return true
}
