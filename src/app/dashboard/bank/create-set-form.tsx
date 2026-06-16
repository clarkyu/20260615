'use client'

import { useActionState, useState } from 'react'
import { Plus } from 'lucide-react'
import { createChunkSet } from '@/actions/bank'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function CreateSetForm() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(createChunkSet, null)

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />{t('bank.newSet')}
      </Button>
    )
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form action={action} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="set-name">{t('bank.setName')}</Label>
            <Input id="set-name" name="name" required placeholder={t('bank.setNamePh')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="set-chunks">{t('bank.chunks')}</Label>
            <p className="whitespace-pre-line text-xs text-muted-foreground">{t('bank.chunksHint')}</p>
            <Textarea id="set-chunks" name="chunks" rows={10} required placeholder={'Time flies. | 时光飞逝\nUsed to say that time passes very quickly. | 用来表示时间过得非常快。\nI can\'t believe it\'s already December. Time flies! | 真不敢相信已经十二月了，时光飞逝！\n\nLet\'s call it a day. | 今天到此为止\n...'} />
          </div>
          {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>{pending ? t('bank.creating') : t('bank.create')}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t('stu.cancelClass')}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
