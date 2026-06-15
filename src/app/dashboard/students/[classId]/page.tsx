import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { ClassManager } from './class-manager'

export default async function ClassPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId: cid } = await params
  const classId = Number(cid)
  if (!Number.isInteger(classId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  if (!user.schoolId) redirect('/dashboard')

  const cls = await prisma.classGroup.findFirst({
    where: { id: classId, schoolId: user.schoolId },
    include: { major: { include: { department: { select: { name: true } } } } },
  })
  if (!cls) notFound()

  const [students, allClasses, majors] = await Promise.all([
    prisma.user.findMany({
      where: { classId, role: 'STUDENT' },
      orderBy: { studentNo: 'asc' },
      select: { id: true, studentNo: true, name: true, phone: true },
    }),
    prisma.classGroup.findMany({ where: { schoolId: user.schoolId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.major.findMany({
      where: { schoolId: user.schoolId },
      orderBy: { name: 'asc' },
      include: { department: { select: { name: true } } },
    }),
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
          department: cls.major?.department.name ?? '',
        }}
        students={students.map((s) => ({ id: s.id, studentNo: s.studentNo ?? '', name: s.name ?? '', phone: s.phone ?? '' }))}
        allClasses={allClasses}
        majors={majors.map((m) => ({ id: m.id, name: m.name, department: m.department.name }))}
      />
    </div>
  )
}
