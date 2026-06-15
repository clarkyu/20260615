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
    classId: Number(formData.get('classId')),
    year: (formData.get('year') as string)?.trim(),
    semester: (formData.get('semester') as string)?.trim(),
  }
}

export async function createOffering(prevState: unknown, formData: FormData): Promise<State> {
  const user = await requireStaff()
  const { t } = await getT()
  if (!user.schoolId) return { error: t('err.createSchoolFirst') }
  const prisma = await getDb()
  const f = await readForm(formData)
  if (!f.courseName || !f.courseCode) return { error: t('err.needCourse') }
  if (!f.classId) return { error: t('err.needClass') }
  if (!f.year || !f.semester) return { error: t('err.needTerm') }

  const cls = await prisma.classGroup.findFirst({ where: { id: f.classId, schoolId: user.schoolId } })
  if (!cls) return { error: t('err.classNotFound') }

  const course = await prisma.course.upsert({
    where: { schoolId_code: { schoolId: user.schoolId, code: f.courseCode } },
    update: { name: f.courseName },
    create: { schoolId: user.schoolId, name: f.courseName, code: f.courseCode },
  })

  const existing = await prisma.courseOffering.findFirst({
    where: { courseId: course.id, classId: f.classId, year: f.year, semester: f.semester },
  })
  if (existing) redirect(`/dashboard/teaching/${existing.id}`)

  const offering = await prisma.courseOffering.create({
    data: { schoolId: user.schoolId, courseId: course.id, teacherId: user.userId, classId: f.classId, year: f.year, semester: f.semester },
  })
  revalidatePath('/dashboard/teaching')
  redirect(`/dashboard/teaching/${offering.id}`)
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
  if (!f.courseName || !f.courseCode) return { error: t('err.needCourse') }
  if (!f.classId) return { error: t('err.needClass') }
  if (!f.year || !f.semester) return { error: t('err.needTerm') }
  const cls = await prisma.classGroup.findFirst({ where: { id: f.classId, schoolId: user.schoolId } })
  if (!cls) return { error: t('err.classNotFound') }

  const course = await prisma.course.upsert({
    where: { schoolId_code: { schoolId: user.schoolId, code: f.courseCode } },
    update: { name: f.courseName },
    create: { schoolId: user.schoolId, name: f.courseName, code: f.courseCode },
  })
  await prisma.courseOffering.update({
    where: { id: offeringId },
    data: { courseId: course.id, classId: f.classId, year: f.year, semester: f.semester },
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
