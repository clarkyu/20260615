import type { PrismaClient } from '@prisma/client'

// Per-teacher BYOK API keys (encrypted). A teacher only ever touches their own.

// Which slots a teacher has configured, with the masked tail only (never the secret).
export function listForUser(prisma: PrismaClient, userId: number) {
  return prisma.aiKey.findMany({ where: { userId }, select: { provider: true, last4: true } })
}

// The encrypted secret for one slot (for the grading pipeline to decrypt).
export function findSecret(prisma: PrismaClient, userId: number, provider: string) {
  return prisma.aiKey.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { ciphertext: true, iv: true },
  })
}

// Insert-or-update without an interactive transaction (D1-safe): update first,
// create only if nothing was there.
export async function upsert(prisma: PrismaClient, userId: number, provider: string, data: { ciphertext: string; iv: string; last4: string }) {
  const updated = await prisma.aiKey.updateMany({ where: { userId, provider }, data })
  if (updated.count === 0) await prisma.aiKey.create({ data: { userId, provider, ...data } })
}

export function remove(prisma: PrismaClient, userId: number, provider: string) {
  return prisma.aiKey.deleteMany({ where: { userId, provider } })
}
