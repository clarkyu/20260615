import type { PrismaClient } from '@prisma/client'

// User feedback / suggestions. Points are DERIVED (not a stored balance):
//   每提交一条 +10；被采纳（status ADOPTED）再 +100。
export const POINTS_PER_SUBMISSION = 10
export const POINTS_PER_ADOPTED = 100

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

// A user's derived points = submissions×10 + adopted×100.
export async function pointsForUser(prisma: PrismaClient, userId: number): Promise<{ total: number; submitted: number; adopted: number }> {
  const [submitted, adopted] = await Promise.all([
    prisma.feedback.count({ where: { userId } }),
    prisma.feedback.count({ where: { userId, status: 'ADOPTED' } }),
  ])
  return { total: submitted * POINTS_PER_SUBMISSION + adopted * POINTS_PER_ADOPTED, submitted, adopted }
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
