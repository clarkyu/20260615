import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import * as offeringRepo from '@/lib/repo/offerings'
import * as classRepo from '@/lib/repo/classes'
import { OfferingForm, type OfferingInitial } from '../../offering-form'

export default async function EditOfferingPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId: oid } = await params
  const offeringId = Number(oid)
  if (!Number.isInteger(offeringId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  if (!user.schoolId) redirect('/dashboard')

  const o = await offeringRepo.findForSchoolWithCourse(prisma, offeringId, user.schoolId)
  if (!o) notFound()

  const classes = await classRepo.listForSchool(prisma, user.schoolId)

  const initial: OfferingInitial = {
    id: o.id,
    courseName: o.course.name,
    courseCode: o.course.code,
    classId: o.classId,
    year: o.year,
    semester: o.semester,
  }

  return (
    <div className="py-2">
      <OfferingForm classes={classes} initial={initial} />
    </div>
  )
}
