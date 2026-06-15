import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { OfferingForm } from '../offering-form'

export default async function NewOfferingPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const classes = await prisma.classGroup.findMany({
    where: { schoolId: user.schoolId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  if (classes.length === 0) {
    return (
      <div className="space-y-3 py-2">
        <h1 className="text-2xl font-bold tracking-tight">{t('teach.newTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('asg.needClassFirst')}</p>
      </div>
    )
  }

  return (
    <div className="py-2">
      <OfferingForm classes={classes} />
    </div>
  )
}
