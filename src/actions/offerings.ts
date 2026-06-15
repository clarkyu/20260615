'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireStaff } from '@/lib/auth'
import { getT } from '@/lib/i18n-server'

type State = { error?: string; success?: boolean }

async function readForm(formData: FormData) {
  return {
    courseName: (formData.get('courseName') as string)?.trim(),
    courseCode: (formData.get('courseCode') as string)?.trim().toUpperCase(),
    year: (formData.get('year') as string)?.trim(),
    semester: (formData.get('semester') as string)?.trim(),
  }
}

export async function createOffering(prevState: unknown, formData: FormData): Promise<State> {
  const user = await requireStaff()
  const { t } = await getT()
  if (!user.schoolId) return { error: t('err.createSchoolFirst') }
  const schoolId = user.schoolId
  const prisma = await getDb()
  const f = await readForm(formData)
  // One offering per class — the teacher may pick several classes at once.
  const classIds = [...new Set(formData.getAll('classId').map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))]
  if (!f.courseName || !f.courseCode) return { error: t('err.needCourse') }
  if (classIds.length === 0) return { error: t('err.needClass') }
  if (!f.year || !f.semester) return { error: t('err.needTerm') }

  const validClasses = await prisma.classGroup.findMany({
    where: { id: { in: classIds }, schoolId },
    select: { id: true },
  })
  if (validClasses.length === 0) return { error: t('err.classNotFound') }
  const validIds = validClasses.map((c) => c.id)

  const course = await prisma.course.upsert({
    where: { schoolId_code: { schoolId, code: f.courseCode } },
    update: { name: f.courseName },
    create: { schoolId, name: f.courseName, code: f.courseCode },
  })

  // Skip classes that already have this exact offering (course + term).
  const existing = await prisma.courseOffering.findMany({
    where: { courseId: course.id, year: f.year, semester: f.semester, classId: { in: validIds } },
    select: { classId: true },
  })
  const existingClassIds = new Set(existing.map((o) => o.classId))
  const toCreate = validIds.filter((id) => !existingClassIds.has(id))

  if (toCreate.length > 0) {
    await prisma.courseOffering.createMany({
      data: toCreate.map((classId) => ({
        schoolId,
        courseId: course.id,
        teacherId: user.userId,
        classId,
        year: f.year,
        semester: f.semester,
      })),
    })
  }
  revalidatePath('/dashboard/teaching')

  // Single class → jump straight to its offering; several → back to the list.
  if (validIds.length === 1) {
    const one = await prisma.courseOffering.findFirst({
      where: { courseId: course.id, year: f.year, semester: f.semester, classId: validIds[0] },
      select: { id: true },
    })
    if (one) redirect(`/dashboard/teaching/${one.id}`)
  }
  redirect('/dashboard/teaching')
}

export async function updateOffering(prevState: unknown, formData: FormData): Promise<State> {
  const user = await requireStaff()
  const { t } = await getT()
  if (!user.schoolId) return { error: t('err.createSchoolFirst') }
  const prisma = await getDb()
  const offeringId = Number(formData.get('offeringId'))
  const offering = await prisma.courseOffering.findFirst({ where: { id: offeringId, schoolId: user.schoolId }, include: { course: true } })
  if (!offering) return { error: t('err.offeringNotFound') }

  const f = await readForm(formData)
  const classId = Number(formData.get('classId'))
  if (!f.courseName || !f.courseCode) return { error: t('err.needCourse') }
  if (!classId) return { error: t('err.needClass') }
  if (!f.year || !f.semester) return { error: t('err.needTerm') }
  const cls = await prisma.classGroup.findFirst({ where: { id: classId, schoolId: user.schoolId } })
  if (!cls) return { error: t('err.classNotFound') }

  const course = await prisma.course.upsert({
    where: { schoolId_code: { schoolId: user.schoolId, code: f.courseCode } },
    update: { name: f.courseName },
    create: { schoolId: user.schoolId, name: f.courseName, code: f.courseCode },
  })
  await prisma.courseOffering.update({
    where: { id: offeringId },
    data: { courseId: course.id, classId, year: f.year, semester: f.semester },
  })
  revalidatePath(`/dashboard/teaching/${offeringId}`)
  redirect(`/dashboard/teaching/${offeringId}`)
}

export async function deleteOffering(formData: FormData): Promise<void> {
  const user = await requireStaff()
  const prisma = await getDb()
  const offeringId = Number(formData.get('offeringId'))
  const offering = await prisma.courseOffering.findFirst({ where: { id: offeringId, schoolId: user.schoolId ?? -1 } })
  if (offering) await prisma.courseOffering.delete({ where: { id: offeringId } })
  revalidatePath('/dashboard/teaching')
  redirect('/dashboard/teaching')
}
