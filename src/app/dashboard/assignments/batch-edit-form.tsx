'use client'

import { useActionState, useState } from 'react'
import { Pencil } from 'lucide-react'
import { editAssignmentBatch } from '@/actions/assignments'
import { ASSIGNMENT_MODES } from '@/lib/assignment-mode'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

// 批次卡展开区里的「编辑批次」:改名 + 定性质(作业/训练/测评/考试),一次写到批内
// 所有班的作业。保存成功后 revalidate 刷新列表,卡片标题/标签即时更新。
export function BatchEditForm({ assignmentIds, title, mode }: { assignmentIds: number[]; title: string; mode: string | null }) {
  const t = useT()
  const [state, action, pending] = useActionState(editAssignmentBatch, null)
  const [name, setName] = useState(title)
  const [kind, setKind] = useState(mode ?? '')

  return (
    <details className="rounded-xl border border-input">
      <summary className="tap flex cursor-pointer items-center gap-1.5 p-3 text-sm font-medium">
        <Pencil className="h-4 w-4 text-muted-foreground" />{t('batch.edit')}
      </summary>
      <form action={action} className="space-y-3 border-t border-border/60 p-3">
        <input type="hidden" name="assignmentIds" value={assignmentIds.join(',')} />
        <div className="space-y-1.5">
          <Label htmlFor={`batch-title-${assignmentIds[0]}`}>{t('batch.titleLabel')}</Label>
          <Input id={`batch-title-${assignmentIds[0]}`} name="title" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`batch-mode-${assignmentIds[0]}`}>{t('asg.fMode')}</Label>
          <Select id={`batch-mode-${assignmentIds[0]}`} name="mode" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{t('asg.fModeNone')}</option>
            {ASSIGNMENT_MODES.map((m) => (
              <option key={m} value={m}>{t(`mode.${m}`)}</option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">{t('asg.fModeHint')}</p>
        </div>
        {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
        {state?.success ? <FormMessage tone="success">{t('batch.saved')}</FormMessage> : null}
        <Button type="submit" size="sm" disabled={pending} className="w-full">
          {pending ? t('asg.saving') : t('asg.save')}
        </Button>
      </form>
    </details>
  )
}
