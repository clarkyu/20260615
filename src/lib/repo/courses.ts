import type { PrismaClient } from '@prisma/client'

// Course (课程) data access. A course is keyed by (school, code); upserting keeps
// the name in sync without duplicating courses when the same code is reused.

export function upsertCourse(prisma: PrismaClient, schoolId: number, code: string, name: string) {
  return prisma.course.upsert({
    where: { schoolId_code: { schoolId, code } },
    update: { name },
    create: { schoolId, name, code },
  })
}
