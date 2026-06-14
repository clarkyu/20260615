import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { NewAssignmentForm } from './new-assignment-form'

export default async function NewAssignmentPage() {
  const user = await requireStaff()
  const me = await prisma.user.findUnique({ where: { id: user.userId } })
  if (!me?.schoolId) redirect('/dashboard')

  const classes = await prisma.classGroup.findMany({
    where: { schoolId: me.schoolId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  if (classes.length === 0) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-bold">新建作业</h1>
        <p className="text-sm text-muted-foreground">请先在「学生」页导入名单（会自动建班），再来发布作业。</p>
      </div>
    )
  }

  return <NewAssignmentForm classes={classes} />
}
