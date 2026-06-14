'use client'

import { useActionState } from 'react'
import { createAssignment } from '@/actions/assignments'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function NewAssignmentForm({ classes }: { classes: { id: number; name: string }[] }) {
  const [state, action, isPending] = useActionState(createAssignment, null)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">新建背诵作业</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">标题</Label>
            <Input id="title" name="title" required placeholder="如 五月背诵 50 句" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="monthLabel">月份（可选）</Label>
            <Input id="monthLabel" name="monthLabel" placeholder="2026-05" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sentences">背诵句子（每行一句）</Label>
            <textarea
              id="sentences"
              name="sentences"
              required
              rows={8}
              placeholder={'1. The early bird catches the worm.\n2. Actions speak louder than words.'}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <Label>分配班级</Label>
            <div className="space-y-1 rounded-md border p-3">
              {classes.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="classIds" value={c.id} className="h-4 w-4" />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="openAt">开放时间（可选）</Label>
              <Input id="openAt" name="openAt" type="datetime-local" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dueAt">截止时间（可选）</Label>
              <Input id="dueAt" name="dueAt" type="datetime-local" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="maxAttempts">可提交次数</Label>
              <Input id="maxAttempts" name="maxAttempts" type="number" min={1} defaultValue={1} />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" name="requireEyesClosed" defaultChecked className="h-4 w-4" />
              要求闭眼背诵
            </label>
          </div>

          {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? '发布中…' : '发布作业'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
