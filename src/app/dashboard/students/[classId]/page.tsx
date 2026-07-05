import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import * as classRepo from '@/lib/repo/classes'
import * as userRepo from '@/lib/repo/users'
import * as majorRepo from '@/lib/repo/majors'
import { ClassManager } from './class-manager'

export default async function ClassPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId: cid } = await params
  const classId = Number(cid)
  if (!Number.isInteger(classId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  if (!user.schoolId) redirect('/dashboard')

  const cls = await classRepo.findDetailForSchool(prisma, classId, user.schoolId)
  if (!cls) notFound()
  const isAdmin = user.role === 'SCHOOL_ADMIN' || user.role === 'SUPER_ADMIN'

  const [students, majors, deleteImpact] = await Promise.all([
    userRepo.listStudentsInClass(prisma, classId),
    majorRepo.listForSchool(prisma, user.schoolId),
    // Only admins see the delete button; compute its blast radius so the confirm is honest.
    isAdmin ? classRepo.classDeletionImpact(prisma, classId, user.schoolId) : Promise.resolve(null),
  ])

  return (
    <div className="py-2">
      <ClassManager
        cls={{
          id: cls.id,
          name: cls.name,
          grade: cls.grade ?? '',
          majorId: cls.majorId,
          major: cls.major?.name ?? '',
          department: cls.major?.department?.name ?? '',
        }}
        students={students.map((s) => ({ id: s.id, studentNo: s.studentNo ?? '', name: s.name ?? '', phone: s.phone ?? '', email: s.email ?? '' }))}
        majors={majors.map((m) => ({ id: m.id, name: m.name, department: m.department?.name ?? '' }))}
        isAdmin={isAdmin}
        deleteImpact={deleteImpact}
      />
    </div>
  )
}
