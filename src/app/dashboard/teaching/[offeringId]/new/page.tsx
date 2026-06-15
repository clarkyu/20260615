import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { AssignmentForm } from '@/components/assignment-form'

export default async function NewAssignmentPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId: oid } = await params
  const offeringId = Number(oid)
  if (!Number.isInteger(offeringId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  if (!user.schoolId) redirect('/dashboard')

  const offering = await prisma.courseOffering.findFirst({ where: { id: offeringId, schoolId: user.schoolId } })
  if (!offering) notFound()

  // Sibling offerings = the same course taught to other classes in the same term.
  // The teacher can tick several to publish the assignment to all at once.
  const siblings = await prisma.courseOffering.findMany({
    where: {
      schoolId: user.schoolId,
      courseId: offering.courseId,
      year: offering.year,
      semester: offering.semester,
      ...(user.role === 'TEACHER' ? { teacherId: user.userId } : {}),
    },
    include: { class: { select: { name: true } } },
  })
  const targets = siblings
    .map((o) => ({ offeringId: o.id, className: o.class.name }))
    .sort((a, b) => a.className.localeCompare(b.className))

  return (
    <div className="py-2">
      <AssignmentForm offeringId={offeringId} targets={targets} />
    </div>
  )
}
