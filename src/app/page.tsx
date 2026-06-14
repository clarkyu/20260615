import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser, homePathForRole } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const APP_NAME = process.env.APP_NAME || '英语背诵作业'

export default async function HomePage() {
  const user = await getCurrentUser()
  if (user) redirect(homePathForRole(user.role))

  return (
    <div className="space-y-6 py-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{APP_NAME}</h1>
        <p className="text-sm text-muted-foreground">闭眼背诵 · 录制提交 · AI 评阅 · 按班级统计</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">我是学生</CardTitle>
          <CardDescription>用学校代码 + 学号登录，完成背诵作业。</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/student-login">
            <Button className="w-full">学生登录</Button>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">我是老师</CardTitle>
          <CardDescription>导入名单、发布作业、AI 评阅并导出成绩。</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Link href="/login" className="flex-1">
            <Button variant="outline" className="w-full">
              老师登录
            </Button>
          </Link>
          <Link href="/register" className="flex-1">
            <Button className="w-full">注册</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
