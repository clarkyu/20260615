import type { PrismaClient } from '@prisma/client'

// User feedback / suggestions. The +N/条 point *policy* lives in `lib/domain/points.ts`
// (`PTS`, single source of truth) — this repo only returns the raw counts it's derived from.
export function create(prisma: PrismaClient, data: { userId: number; schoolId: number | null; body: string }) {
  return prisma.feedback.create({ data })
}

// One user's own feedback, newest first.
export function listForUser(prisma: PrismaClient, userId: number) {
  return prisma.feedback.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, body: true, status: true, reply: true, createdAt: true },
  })
}

// Raw feedback counts for one user (the point total is computed from these by the domain layer).
export async function pointsForUser(prisma: PrismaClient, userId: number): Promise<{ submitted: number; adopted: number }> {
  const [submitted, adopted] = await Promise.all([
    prisma.feedback.count({ where: { userId } }),
    prisma.feedback.count({ where: { userId, status: 'ADOPTED' } }),
  ])
  return { submitted, adopted }
}

// All feedback for the super-admin review queue, pending first then newest.
export function listAllForReview(prisma: PrismaClient) {
  return prisma.feedback.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true, body: true, status: true, reply: true, createdAt: true,
      user: { select: { name: true, studentNo: true, staffNo: true, role: true, school: { select: { name: true } } } },
    },
    take: 500,
  })
}

// Adopt / decline a piece of feedback (super-admin). Status drives the +100 reward.
export function setStatus(prisma: PrismaClient, id: number, status: 'ADOPTED' | 'DECLINED' | 'PENDING', reply: string | null) {
  return prisma.feedback.update({ where: { id }, data: { status, reply, reviewedAt: new Date() } })
}
