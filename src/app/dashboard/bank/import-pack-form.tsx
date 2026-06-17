'use client'

import { type FormEvent } from 'react'
import { importPackAction } from '@/actions/bank'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { BankMetaFields } from './bank-meta-fields'
import { useChunkedImport } from './use-chunked-import'

// Controlled "build a pack" panel (super-admin): paste many three-part chunks,
// name + classify it, auto-split into sets of N, import as global official. The
// import is bounded + resumable: the form's data is re-submitted until done.
export function ImportPackForm({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { run, pending, msg } = useChunkedImport()

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    run(() => importPackAction(null, fd))
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form onSubmit={onSubmit} className="space-y-3">
          <p className="text-xs text-muted-foreground">{t('pack.hint')}</p>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pack-name">{t('pack.name')}</Label>
              <Input id="pack-name" name="name" required placeholder={t('pack.namePh')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pack-per">{t('pack.perSet')}</Label>
              <Input id="pack-per" name="perSet" type="number" min={1} max={500} defaultValue={50} className="w-24" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pack-chunks">{t('bank.chunks')}</Label>
            <p className="whitespace-pre-line text-xs text-muted-foreground">{t('bank.chunksHint')}</p>
            <Textarea id="pack-chunks" name="chunks" rows={12} required />
          </div>
          <BankMetaFields />
          {msg ? <FormMessage>{msg}</FormMessage> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>{pending ? t('bank.importing') : t('pack.import')}</Button>
            <Button type="button" variant="ghost" onClick={onClose}>{t('stu.cancelClass')}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
