'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireStaff } from '@/lib/auth'
import { getT } from '@/lib/i18n-server'
import { parseForm, reqText, reqId, idList, z } from '@/lib/validate'

type State = { error?: string; success?: boolean }

const courseFields = {
  courseName: reqText('err.needCourse', 100),
  courseCode: reqText('err.needCourse', 50),
  year: reqText('err.needTerm', 20),
  semester: reqText('err.needTerm', 10),
}

export async function createOffering(prevState: unknown, formData: FormData): Promise<State> {
  const user = await requireStaff()
  const { t } = await getT()
  if (!user.schoolId) return { error: t('err.createSchoolFirst') }
  const schoolId = user.schoolId
  const prisma = await getDb()
  const parsed = parseForm(z.object({ ...courseFields, classId: idList }), formData)
  if (!parsed.ok) return { error: t(parsed.error) }
  const f = { ...parsed.data, courseCode: parsed.data.courseCode.toUpperCase() }
  // One offering per class — the teacher may pick several classes at once.
  const classIds = [...new Set(parsed.data.classId)]
  if (classIds.length === 0) return { error: t('err.needClass') }

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
  const parsed = parseForm(z.object({ ...courseFields, offeringId: reqId, classId: reqId }), formData)
  if (!parsed.ok) return { error: t(parsed.error) }
  const offeringId = parsed.data.offeringId
  const offering = await prisma.courseOffering.findFirst({ where: { id: offeringId, schoolId: user.schoolId }, include: { course: true } })
  if (!offering) return { error: t('err.offeringNotFound') }

  const f = { ...parsed.data, courseCode: parsed.data.courseCode.toUpperCase() }
  const classId = parsed.data.classId
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
