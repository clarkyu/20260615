import type { PrismaClient, Prisma } from '@prisma/client'
import type { ChunkInput } from '@/lib/bank'

// Tenant-scoped data access for the item bank (题库：句集 + 三段式句子). The
// chunk-row mapping lives here so create and replace stay identical.
//
// Scoping has two flavours:
//  · VISIBLE (read/use): a school's own sets + platform-global sets (schoolId
//    null = official, shared with every school).
//  · OWNED (mutate): a school's own sets; a SUPER_ADMIN additionally owns the
//    global pool. Global sets stay read-only to ordinary teachers because their
//    scope is a concrete schoolId, which never matches a NULL row.

export interface ChunkSetMeta {
  cefr: string | null
  strand: string | null
  domain: string | null
  tags: string | null
  source: string | null
  series: string | null
}

// Read scope: own school OR global (schoolId null). Exported for policy tests —
// this is the cross-tenant visibility boundary.
export function visibleWhere(schoolId: number | null | undefined): Prisma.ChunkSetWhereInput {
  return { OR: [{ schoolId: schoolId ?? -1 }, { schoolId: null }] }
}

// Mutate scope: own school, plus the global pool for a super-admin. A concrete
// schoolId never matches a NULL row, so global sets stay read-only to teachers.
export function ownedWhere(schoolId: number | null | undefined, isSuperAdmin: boolean): Prisma.ChunkSetWhereInput {
  const own: Prisma.ChunkSetWhereInput = { schoolId: schoolId ?? -1 }
  return isSuperAdmin ? { OR: [own, { schoolId: null }] } : own
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

// Authorize a mutation (edit/delete/video): returns the set only if this actor
// owns it (own school, or global when super-admin).
export function findOwned(prisma: PrismaClient, id: number, schoolId: number | null | undefined, isSuperAdmin: boolean) {
  return prisma.chunkSet.findFirst({ where: { id, ...ownedWhere(schoolId, isSuperAdmin) } })
}

// Stable `source` keys already present in a scope — lets the starter-pack import
// skip sets imported before (idempotent re-import). `schoolId: null` checks the
// global pool; a number checks that school.
export async function importedSources(prisma: PrismaClient, where: Prisma.ChunkSetWhereInput): Promise<Set<string>> {
  const rows = await prisma.chunkSet.findMany({
    where: { ...where, source: { not: null } },
    select: { source: true },
  })
  return new Set(rows.map((r) => r.source).filter((s): s is string => s !== null))
}

// Sources visible to a school (own + global) — dedup target for a teacher import
// so they never duplicate official content that's already global.
export function visibleSources(prisma: PrismaClient, schoolId: number | null | undefined) {
  return importedSources(prisma, visibleWhere(schoolId))
}
// Sources already in the global pool — dedup target for a super-admin global import.
export function globalSources(prisma: PrismaClient) {
  return importedSources(prisma, { schoolId: null })
}

export interface BankFilters {
  cefr?: string
  strand?: string
  domain?: string
  series?: string
}

// Set list for the bank index — own + global, name, video presence, chunk count,
// level/skill/series for grouping + badges, ownership (schoolId) to badge official
// + gate edit. Optional filters (each ANDed when present). Grouped by series, then
// ordered by name so a series' "· NNNN–MMMM" ranges read in order.
export function listVisible(prisma: PrismaClient, schoolId: number | null | undefined, filters?: BankFilters) {
  return prisma.chunkSet.findMany({
    where: {
      AND: [
        visibleWhere(schoolId),
        ...(filters?.cefr ? [{ cefr: filters.cefr }] : []),
        ...(filters?.strand ? [{ strand: filters.strand }] : []),
        ...(filters?.domain ? [{ domain: filters.domain }] : []),
        ...(filters?.series ? [{ series: filters.series }] : []),
      ],
    },
    select: { id: true, schoolId: true, name: true, shadowVideoKey: true, cefr: true, strand: true, series: true, _count: { select: { chunks: true } } },
    orderBy: [{ series: 'asc' }, { name: 'asc' }],
  })
}

// Distinct series visible to a school (own + global), for the series filter.
export async function seriesList(prisma: PrismaClient, schoolId: number | null | undefined): Promise<string[]> {
  const rows = await prisma.chunkSet.findMany({
    where: { AND: [visibleWhere(schoolId), { series: { not: null } }] },
    select: { series: true },
    distinct: ['series'],
    orderBy: { series: 'asc' },
  })
  return rows.map((r) => r.series).filter((s): s is string => s !== null)
}

// A set's header summary (no chunk rows) — for the publish-from-set screen.
export function findSummaryVisible(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.chunkSet.findFirst({
    where: { id, ...visibleWhere(schoolId) },
    select: { id: true, name: true, shadowVideoKey: true, _count: { select: { chunks: true } } },
  })
}

// The set plus its ordered chunks — used to view a set and to publish from it.
export function findWithChunksVisible(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.chunkSet.findFirst({
    where: { id, ...visibleWhere(schoolId) },
    include: { chunks: { orderBy: { order: 'asc' } } },
  })
}

// Standalone create (not nested in $transaction) so D1 can resolve the new set id
// for the chunk inserts. `schoolId: null` creates a platform-global set. Returns
// the new set id.
export async function createWithChunks(prisma: PrismaClient, schoolId: number | null, name: string, chunks: ChunkInput[], meta?: ChunkSetMeta): Promise<number> {
  const set = await prisma.chunkSet.create({ data: { schoolId, name, ...meta } })
  await prisma.chunk.createMany({ data: chunkRows(set.id, chunks) })
  return set.id
}

// Rename + replace every chunk in one batch ($transaction of statements is fine on
// D1 — only interactive transactions are unavailable). Authorize via findOwned first.
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

// Delete only if the actor owns the set (own school, or global when super-admin).
export async function deleteOwned(prisma: PrismaClient, id: number, schoolId: number | null | undefined, isSuperAdmin: boolean): Promise<boolean> {
  const found = await prisma.chunkSet.findFirst({ where: { id, ...ownedWhere(schoolId, isSuperAdmin) }, select: { id: true } })
  if (!found) return false
  await prisma.chunkSet.delete({ where: { id } })
  return true
}
