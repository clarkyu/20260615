import type { PrismaClient } from '@prisma/client'

// School teacher-invite data access. Only the token HASH is stored; an invite is
// single-use (usedAt) and time-limited (expiresAt).

export function create(prisma: PrismaClient, data: { tokenHash: string; schoolId: number; createdById: number; expiresAt: Date }) {
  return prisma.schoolInvite.create({ data })
}

// A usable invite for this token hash: exists, not used, not expired — with its school.
export function findValidByHash(prisma: PrismaClient, tokenHash: string, now: Date) {
  return prisma.schoolInvite.findFirst({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    select: { id: true, schoolId: true, school: { select: { name: true } } },
  })
}

export function markUsed(prisma: PrismaClient, id: number, at: Date) {
  // Fence on usedAt:null so two simultaneous accepts can't both consume one invite.
  return prisma.schoolInvite.updateMany({ where: { id, usedAt: null }, data: { usedAt: at } })
}
