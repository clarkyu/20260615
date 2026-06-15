import { getDb } from '@/lib/db'
import { StudentLoginForm } from './student-login-form'

export const dynamic = 'force-dynamic'

export default async function StudentLoginPage() {
  const prisma = await getDb()
  const schools = await prisma.school.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
  return <StudentLoginForm schools={schools} />
}
