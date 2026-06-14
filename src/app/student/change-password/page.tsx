'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { changePassword } from '@/actions/auth'
import { AuthShell } from '@/components/auth-shell'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function StudentChangePasswordPage() {
  const [state, action, isPending] = useActionState(changePassword, null)

  if (state?.success) {
    return (
      <AuthShell title="密码已修改" description="请用新密码重新登录。">
        <Link href="/student-login">
          <Button className="w-full">去登录</Button>
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="设置新密码" description="首次登录请修改初始密码（至少 8 位）。">
      <form action={action} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="currentPassword">当前密码（学号）</Label>
          <Input id="currentPassword" name="currentPassword" type="password" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="newPassword">新密码</Label>
          <Input id="newPassword" name="newPassword" type="password" required minLength={8} placeholder="至少 8 位" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">确认新密码</Label>
          <Input id="confirmPassword" name="confirmPassword" type="password" required minLength={8} />
        </div>
        {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? '提交中…' : '修改密码'}
        </Button>
      </form>
    </AuthShell>
  )
}
