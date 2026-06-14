import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default async function AssignmentsPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const me = await prisma.user.findUnique({ where: { id: user.userId } })
  if (!me?.schoolId) redirect('/dashboard')

  const assignments = await prisma.assignment.findMany({
    where: { schoolId: me.schoolId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { sentences: true, submissions: true, classes: true } },
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">背诵作业</h1>
        <Link href="/dashboard/assignments/new">
          <Button size="sm">新建作业</Button>
        </Link>
      </div>

      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有作业，点「新建作业」发布第一份。</p>
      ) : (
        assignments.map((a) => (
          <Card key={a.id}>
            <CardHeader>
              <CardTitle className="text-lg">{a.title}</CardTitle>
              <CardDescription>
                {a._count.sentences} 句 · {a._count.classes} 个班 · {a._count.submissions} 份提交
                {a.dueAt ? ` · 截止 ${a.dueAt.toISOString().slice(0, 10)}` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/dashboard/assignments/${a.id}`}>
                <Button variant="outline" className="w-full">查看与评阅</Button>
              </Link>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
