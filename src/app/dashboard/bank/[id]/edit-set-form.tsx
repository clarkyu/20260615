'use client'

import { useActionState, useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import { updateChunkSet } from '@/actions/bank'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { BankMetaFields } from '../bank-meta-fields'

// Edit a set by re-pasting the three-part text — matches how teachers input it,
// and fixing a typo is just editing the text and saving.
export function EditSetForm({ setId, name, chunksText, meta }: {
  setId: number
  name: string
  chunksText: string
  meta?: { cefr: string | null; strand: string | null; domain: string | null; tags: string | null; source: string | null }
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(updateChunkSet, null)
  useEffect(() => {
    if (state?.success) setOpen(false)
  }, [state])

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" />{t('bank.edit')}
      </Button>
    )
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form action={action} className="space-y-3">
          <input type="hidden" name="chunkSetId" value={setId} />
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">{t('bank.setName')}</Label>
            <Input id="edit-name" name="name" required defaultValue={name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-chunks">{t('bank.chunks')}</Label>
            <p className="whitespace-pre-line text-xs text-muted-foreground">{t('bank.chunksHint')}</p>
            <Textarea id="edit-chunks" name="chunks" rows={16} required defaultValue={chunksText} />
          </div>
          <BankMetaFields cefr={meta?.cefr} strand={meta?.strand} domain={meta?.domain} tags={meta?.tags} source={meta?.source} />
          {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>{pending ? t('bank.saving') : t('bank.save')}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t('stu.cancelClass')}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
