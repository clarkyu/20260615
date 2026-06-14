import Link from 'next/link'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CreateSchoolForm } from './create-school-form'

export default async function DashboardPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const me = await prisma.user.findUnique({ where: { id: user.userId }, include: { school: true } })

  if (!me?.school) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold">欢迎，{me?.name || me?.email}</h1>
          <p className="text-sm text-muted-foreground">先创建你的学校，学生用这个「学校代码 + 学号」登录。</p>
        </div>
        <CreateSchoolForm />
      </div>
    )
  }

  const [students, classes, assignments] = await Promise.all([
    prisma.user.count({ where: { schoolId: me.school.id, role: 'STUDENT' } }),
    prisma.classGroup.count({ where: { schoolId: me.school.id } }),
    prisma.assignment.count({ where: { schoolId: me.school.id } }),
  ])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{me.school.name}</h1>
        <p className="text-sm text-muted-foreground">
          学校代码 <span className="font-mono font-semibold text-foreground">{me.school.code}</span>（发给学生登录用）
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: '学生', value: students },
          { label: '班级', value: classes },
          { label: '作业', value: assignments },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">学生名单</CardTitle>
          <CardDescription>从 Excel 批量导入学号 / 姓名 / 班级 / 院系 / 专业。</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/dashboard/students">
            <Button className="w-full">管理学生</Button>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">背诵作业</CardTitle>
          <CardDescription>发布 50 句背诵作业，AI 评阅并按班级导出成绩。</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/dashboard/assignments">
            <Button className="w-full">管理作业</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
