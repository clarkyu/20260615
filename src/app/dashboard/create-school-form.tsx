'use client'

import { useActionState } from 'react'
import { createSchool } from '@/actions/schools'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function CreateSchoolForm() {
  const [state, action, isPending] = useActionState(createSchool, null)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">创建学校</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">学校名称</Label>
            <Input id="name" name="name" required placeholder="如 示范大学" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="code">学校代码（学生登录用，3–12 位字母/数字）</Label>
            <Input id="code" name="code" required placeholder="如 DEMO2026" autoCapitalize="characters" />
          </div>
          {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
          {state?.success ? <FormMessage tone="success">已创建。</FormMessage> : null}
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? '创建中…' : '创建学校'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
