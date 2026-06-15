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

  const cls = await prisma.classGroup.findFirst({ where: { id: classId, schoolId: user.schoolId } })
  if (!cls) notFound()

  const [students, allClasses] = await Promise.all([
    prisma.user.findMany({
      where: { classId, role: 'STUDENT' },
      orderBy: { studentNo: 'asc' },
      select: { id: true, studentNo: true, name: true, major: true },
    }),
    prisma.classGroup.findMany({ where: { schoolId: user.schoolId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ])

  return (
    <div className="py-2">
      <ClassManager
        cls={{ id: cls.id, name: cls.name, major: cls.major ?? '', department: cls.department ?? '', grade: cls.grade ?? '' }}
        students={students.map((s) => ({ id: s.id, studentNo: s.studentNo ?? '', name: s.name ?? '', major: s.major ?? '' }))}
        allClasses={allClasses}
      />
    </div>
  )
}
