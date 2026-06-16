import type { PrismaClient } from '@prisma/client'

// School data access. Name and code are both globally unique.

export function findByName(prisma: PrismaClient, name: string) {
  return prisma.school.findUnique({ where: { name } })
}

export function findByCode(prisma: PrismaClient, code: string) {
  return prisma.school.findUnique({ where: { code } })
}

// A school with this name other than the given one (for rename uniqueness).
export function findOtherByName(prisma: PrismaClient, name: string, exceptId: number) {
  return prisma.school.findFirst({ where: { name, NOT: { id: exceptId } } })
}

export function create(prisma: PrismaClient, name: string, code: string) {
  return prisma.school.create({ data: { name, code } })
}

export function rename(prisma: PrismaClient, id: number, name: string) {
  return prisma.school.update({ where: { id }, data: { name } })
}
