import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { OfferingForm, type OfferingInitial } from '../../offering-form'

export default async function EditOfferingPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId: oid } = await params
  const offeringId = Number(oid)
  if (!Number.isInteger(offeringId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  if (!user.schoolId) redirect('/dashboard')

  const o = await prisma.courseOffering.findFirst({ where: { id: offeringId, schoolId: user.schoolId }, include: { course: true } })
  if (!o) notFound()

  const classes = await prisma.classGroup.findMany({
    where: { schoolId: user.schoolId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

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
