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

  return (
    <div className="py-2">
      <AssignmentForm offeringId={offeringId} />
    </div>
  )
}
