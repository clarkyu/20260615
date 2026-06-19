import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import * as offeringRepo from '@/lib/repo/offerings'
import { AssignmentForm } from '@/components/assignment-form'

export default async function NewAssignmentPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId: oid } = await params
  const offeringId = Number(oid)
  if (!Number.isInteger(offeringId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  if (!user.schoolId) redirect('/dashboard')

  const offering = await offeringRepo.findForSchool(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) notFound()

  // Sibling offerings = the same course taught to other classes in the same term.
  // The teacher can tick several to publish the assignment to all at once.
  const siblings = await offeringRepo.listSiblingsForStaff(prisma, user.schoolId, offering, user.userId, user.role)
  const targets = siblings
    .map((o) => ({ offeringId: o.id, label: o.class.name }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="py-2">
      <AssignmentForm offeringId={offeringId} targets={targets} />
    </div>
  )
}
