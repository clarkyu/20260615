import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { NewAssignmentForm } from './new-assignment-form'

export default async function NewAssignmentPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  const me = await prisma.user.findUnique({ where: { id: user.userId } })
  if (!me?.schoolId) redirect('/dashboard')

  const classes = await prisma.classGroup.findMany({
    where: { schoolId: me.schoolId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  if (classes.length === 0) {
    return (
      <div className="space-y-3 py-2">
        <h1 className="text-2xl font-bold tracking-tight">{t('asg.newTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('asg.needClassFirst')}</p>
      </div>
    )
  }

  return (
    <div className="py-2">
      <NewAssignmentForm classes={classes} />
    </div>
  )
}
