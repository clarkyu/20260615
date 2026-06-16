import type { PrismaClient } from '@prisma/client'
import type { ChunkInput } from '@/lib/bank'

// Tenant-scoped data access for the item bank (题库：句集 + 三段式句子). The
// chunk-row mapping lives here so create and replace stay identical.

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

// The set plus its ordered chunks — used when publishing an assignment from a set.
export function findWithChunksForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.chunkSet.findFirst({
    where: { id, schoolId: schoolId ?? -1 },
    include: { chunks: { orderBy: { order: 'asc' } } },
  })
}

// Standalone create (not nested in $transaction) so D1 can resolve the new set id
// for the chunk inserts. Returns the new set id.
export async function createWithChunks(prisma: PrismaClient, schoolId: number, name: string, chunks: ChunkInput[]): Promise<number> {
  const set = await prisma.chunkSet.create({ data: { schoolId, name } })
  await prisma.chunk.createMany({ data: chunkRows(set.id, chunks) })
  return set.id
}

// Rename + replace every chunk in one batch ($transaction of statements is fine on
// D1 — only interactive transactions are unavailable).
export function replaceChunks(prisma: PrismaClient, id: number, name: string, chunks: ChunkInput[]) {
  return prisma.$transaction([
    prisma.chunkSet.update({ where: { id }, data: { name } }),
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
