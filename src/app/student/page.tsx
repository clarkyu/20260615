import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const STATUS_LABEL: Record<string, string> = {
  DRAFT: '未提交',
  UPLOADED: '已提交 · 待评阅',
  PROCESSING: '评阅中',
  GRADED: '已评阅',
  FLAGGED: '已提交 · 需复核',
  FAILED: '评阅失败',
}

export default async function StudentHome() {
  const user = await requireRole('STUDENT')
  const me = await prisma.user.findUnique({ where: { id: user.userId } })
  if (me?.mustChangePassword) redirect('/student/change-password')
  if (!me?.classId) {
    return <p className="text-sm text-muted-foreground">你的账号还未分配班级，请联系老师。</p>
  }

  const assignments = await prisma.assignment.findMany({
    where: { classes: { some: { classId: me.classId } } },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { sentences: true } },
      submissions: { where: { studentId: user.userId }, orderBy: { attempt: 'desc' }, take: 1 },
    },
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">我的作业</h1>
        <p className="text-sm text-muted-foreground">{me.name}（{me.studentNo}）</p>
      </div>

      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂时没有作业。</p>
      ) : (
        assignments.map((a) => {
          const sub = a.submissions[0]
          const status = sub?.status ?? 'DRAFT'
          return (
            <Card key={a.id}>
              <CardHeader>
                <CardTitle className="text-lg">{a.title}</CardTitle>
                <CardDescription>
                  {a._count.sentences} 句{a.dueAt ? ` · 截止 ${a.dueAt.toISOString().slice(0, 10)}` : ''} ·{' '}
                  {STATUS_LABEL[status]}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {sub?.status === 'GRADED' && sub.finalScore != null ? (
                  <p className="text-sm">
                    得分：<span className="font-semibold">{sub.finalScore}</span>
                    {sub.feedback ? <span className="block text-muted-foreground">{sub.feedback}</span> : null}
                  </p>
                ) : null}
                <Link href={`/student/assignments/${a.id}`}>
                  <Button className="w-full" variant={status === 'DRAFT' ? 'default' : 'outline'}>
                    {status === 'DRAFT' ? '去背诵并录制' : '查看 / 重录'}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}
