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

// 评分用：某句集的三件套（中心句 english / 解释句 meaningEn / 情景例句 exampleEn），按 order 取全。
// 系统级读——评分管线按 phase.chunkSetId 直接取，不做租户 scope（评分是系统流程，非老师面向读）。
export function listChunksForGrading(prisma: PrismaClient, chunkSetId: number) {
  return prisma.chunk.findMany({
    where: { chunkSetId },
    orderBy: { order: 'asc' },
    select: { order: true, english: true, meaningEn: true, exampleEn: true },
  })
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

// For each global official set (keyed by source): its id + how many of its chunks
// already carry a Chinese 中心句. Lets the official-bank refresh detect which sets
// still need source translations pushed (live coverage < source coverage).
export async function globalSetZhCoverage(prisma: PrismaClient): Promise<Map<string, { id: number; withZh: number }>> {
  const sets = await prisma.chunkSet.findMany({ where: { schoolId: null, source: { not: null } }, select: { id: true, source: true } })
  if (sets.length === 0) return new Map()
  const ids = sets.map((s) => s.id)
  const zhRows = await prisma.chunk.findMany({ where: { chunkSetId: { in: ids }, chinese: { not: null } }, select: { chunkSetId: true } })
  const byId = new Map<number, number>()
  for (const r of zhRows) byId.set(r.chunkSetId, (byId.get(r.chunkSetId) ?? 0) + 1)
  return new Map(sets.map((s) => [s.source as string, { id: s.id, withZh: byId.get(s.id) ?? 0 }]))
}

export interface BankFilters {
  cefr?: string
  strand?: string
  domain?: string
  series?: string
  hasVideo?: boolean
}

const SET_LIST_SELECT = { id: true, schoolId: true, name: true, shadowVideoKey: true, cefr: true, strand: true, series: true, _count: { select: { chunks: true } } } as const

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
        ...(filters?.hasVideo ? [{ shadowVideoKey: { not: null } }] : []),
      ],
    },
    select: SET_LIST_SELECT,
    orderBy: [{ series: 'asc' }, { name: 'asc' }],
  })
}

// Sets this teacher most-recently drew from (a phase pulled from a bank set), newest
// first, deduped. D1/Prisma can't order a relation by max(updatedAt), so we read the
// recent phases then resolve their distinct sets, preserving recency order.
export async function listRecentlyUsedByTeacher(prisma: PrismaClient, schoolId: number | null | undefined, teacherId: number, limit = 6) {
  const phases = await prisma.phase.findMany({
    where: { chunkSetId: { not: null }, assignment: { offering: { teacherId } } },
    select: { chunkSetId: true },
    orderBy: { updatedAt: 'desc' },
    take: 60,
  })
  const ids: number[] = []
  for (const p of phases) {
    if (p.chunkSetId != null && !ids.includes(p.chunkSetId)) {
      ids.push(p.chunkSetId)
      if (ids.length >= limit) break
    }
  }
  if (ids.length === 0) return []
  const sets = await prisma.chunkSet.findMany({ where: { id: { in: ids }, ...visibleWhere(schoolId) }, select: SET_LIST_SELECT })
  const byId = new Map(sets.map((s) => [s.id, s]))
  return ids.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => Boolean(s))
}

// ── per-teacher favorites ───────────────────────────────────────────────────────

export async function favoriteSetIds(prisma: PrismaClient, userId: number): Promise<number[]> {
  const rows = await prisma.bankFavorite.findMany({ where: { userId }, select: { chunkSetId: true } })
  return rows.map((r) => r.chunkSetId)
}

// Star/unstar a set for a user; returns the new favorited state.
export async function toggleFavorite(prisma: PrismaClient, userId: number, chunkSetId: number): Promise<boolean> {
  const existing = await prisma.bankFavorite.findUnique({ where: { userId_chunkSetId: { userId, chunkSetId } } })
  if (existing) {
    await prisma.bankFavorite.delete({ where: { id: existing.id } })
    return false
  }
  await prisma.bankFavorite.create({ data: { userId, chunkSetId } })
  return true
}

// A user's starred sets that are still visible to their school, name-ordered.
export async function listFavorites(prisma: PrismaClient, schoolId: number | null | undefined, userId: number) {
  const ids = await favoriteSetIds(prisma, userId)
  if (ids.length === 0) return []
  const sets = await prisma.chunkSet.findMany({ where: { id: { in: ids }, ...visibleWhere(schoolId) }, select: SET_LIST_SELECT })
  return sets.sort((a, b) => a.name.localeCompare(b.name))
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

// Delete only if the actor owns the set (own school, or global when super-admin). Returns
// the set's shadow-video key (if any) so the caller can clean the R2 object — the DB
// cascade-deletes the row but never the file.
export async function deleteOwned(prisma: PrismaClient, id: number, schoolId: number | null | undefined, isSuperAdmin: boolean): Promise<{ deleted: boolean; videoKey: string | null }> {
  const found = await prisma.chunkSet.findFirst({ where: { id, ...ownedWhere(schoolId, isSuperAdmin) }, select: { id: true, shadowVideoKey: true } })
  if (!found) return { deleted: false, videoKey: null }
  await prisma.chunkSet.delete({ where: { id } })
  return { deleted: true, videoKey: found.shadowVideoKey }
}
