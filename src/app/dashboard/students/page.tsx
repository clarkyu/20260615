import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ImportClient } from './import-client'

export default async function StudentsPage() {
  const user = await requireStaff()
  const me = await prisma.user.findUnique({ where: { id: user.userId }, include: { school: true } })
  if (!me?.school) redirect('/dashboard')

  const classes = await prisma.classGroup.findMany({
    where: { schoolId: me.school.id },
    orderBy: { name: 'asc' },
    include: { _count: { select: { members: true } } },
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">学生名单</h1>
        <p className="text-sm text-muted-foreground">导入后，学生用「学校代码 {me.school.code} + 学号」登录，初始密码为学号。</p>
      </div>

      <ImportClient />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">班级（{classes.length}）</CardTitle>
          <CardDescription>导入名单时按「班级」列自动建班。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {classes.length === 0 ? (
            <p className="text-muted-foreground">还没有班级，先导入名单。</p>
          ) : (
            classes.map((c) => (
              <div key={c.id} className="flex justify-between border-b py-1 last:border-0">
                <span>{c.name}{c.major ? ` · ${c.major}` : ''}</span>
                <span className="text-muted-foreground">{c._count.members} 人</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
