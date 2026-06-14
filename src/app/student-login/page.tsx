'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { studentLogin } from '@/actions/auth'
import { AuthShell } from '@/components/auth-shell'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function StudentLoginPage() {
  const [state, action, isPending] = useActionState(studentLogin, null)

  return (
    <AuthShell
      title="学生登录"
      description="用学校代码 + 学号登录。初始密码为你的学号，登录后需要修改。"
      footer={
        <Link href="/login" className="font-medium text-foreground hover:underline">
          我是老师 →
        </Link>
      }
    >
      <form action={action} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="schoolCode">学校代码</Label>
          <Input id="schoolCode" name="schoolCode" autoCapitalize="characters" required placeholder="例如 PKU2026" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="studentNo">学号</Label>
          <Input id="studentNo" name="studentNo" required placeholder="你的学号" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">密码</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required placeholder="初始密码为学号" />
        </div>
        {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? '登录中…' : '登录'}
        </Button>
      </form>
    </AuthShell>
  )
}
