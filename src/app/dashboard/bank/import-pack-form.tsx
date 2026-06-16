'use client'

import { useActionState, useState } from 'react'
import { PackagePlus } from 'lucide-react'
import { importPackAction } from '@/actions/bank'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { BankMetaFields } from './bank-meta-fields'

// Super-admin "build a pack": paste many three-part chunks, name + classify it,
// auto-split into sets of N, import as global official — no per-pack code.
export function ImportPackForm() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(importPackAction, null)

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PackagePlus className="h-4 w-4" />{t('pack.new')}
      </Button>
    )
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form action={action} className="space-y-3">
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
          {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
          {state?.imported != null ? (
            <FormMessage tone="success">{t('bank.imported').replace('{n}', String(state.imported)).replace('{s}', String(state.skipped ?? 0))}</FormMessage>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>{pending ? t('bank.importing') : t('pack.import')}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t('stu.cancelClass')}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
