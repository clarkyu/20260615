// Course-offering orchestration.
//
// Owns the multi-step "publish a course to one or more classes" workflow and the
// edit, free of auth/i18n/Next plumbing. Errors are returned as i18n keys for the
// action to translate; navigation targets are returned for the action to redirect.

import type { PrismaClient } from '@prisma/client'
import * as offerings from '@/lib/repo/offerings'
import * as classes from '@/lib/repo/classes'
import * as courses from '@/lib/repo/courses'

export interface OfferingInput {
  courseName: string
  courseCode: string
  year: string
  semester: string
}

export type CreateResult = { ok: true; redirectTo: string } | { ok: false; error: string }

// Publish one course (by code) to several classes at once — one offering per
// class. Skips classes that already have this exact offering; upserts the course
// so a reused code keeps a single course row.
export async function createOfferings(
  prisma: PrismaClient,
  schoolId: number,
  teacherId: number,
  input: OfferingInput,
  classIds: number[],
): Promise<CreateResult> {
  const code = input.courseCode.toUpperCase()
  const wanted = [...new Set(classIds)]
  if (wanted.length === 0) return { ok: false, error: 'err.needClass' }

  const validIds = await classes.findClassIdsForSchool(prisma, wanted, schoolId)
  if (validIds.length === 0) return { ok: false, error: 'err.classNotFound' }

  const course = await courses.upsertCourse(prisma, schoolId, code, input.courseName)
  const existing = await offerings.existingClassIds(prisma, course.id, input.year, input.semester, validIds)
  const toCreate = validIds.filter((id) => !existing.has(id))
  if (toCreate.length > 0) {
    await offerings.createForClasses(prisma, { schoolId, courseId: course.id, teacherId, year: input.year, semester: input.semester }, toCreate)
  }

  // Single class → jump straight to its offering; several → back to the list.
  if (validIds.length === 1) {
    const one = await offerings.findOne(prisma, course.id, input.year, input.semester, validIds[0])
    if (one) return { ok: true, redirectTo: `/dashboard/teaching/${one.id}` }
  }
  return { ok: true, redirectTo: '/dashboard/teaching' }
}

export type UpdateResult = { ok: true } | { ok: false; error: string }

// Re-point an existing offering at a (possibly new) course code + class + term.
export async function updateOffering(
  prisma: PrismaClient,
  schoolId: number,
  offeringId: number,
  input: OfferingInput,
  classId: number,
): Promise<UpdateResult> {
  const offering = await offerings.findForSchoolWithCourse(prisma, offeringId, schoolId)
  if (!offering) return { ok: false, error: 'err.offeringNotFound' }

  const cls = await classes.findClassForSchool(prisma, classId, schoolId)
  if (!cls) return { ok: false, error: 'err.classNotFound' }

  const course = await courses.upsertCourse(prisma, schoolId, input.courseCode.toUpperCase(), input.courseName)
  await offerings.update(prisma, offeringId, { courseId: course.id, classId, year: input.year, semester: input.semester })
  return { ok: true }
}
