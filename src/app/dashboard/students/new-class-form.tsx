'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { addClassGroup } from '@/actions/students'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Create an empty class by 班号 — no Excel roster required to get started.
export function NewClassForm() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(addClassGroup, null)
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset()
      setOpen(false)
    }
  }, [state])

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />{t('stu.newClass')}
      </Button>
    )
  }

  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-center gap-2">
      <Input name="name" required placeholder={t('stu.classNamePh')} className="h-10 w-44" />
      <Input name="grade" placeholder={t('stu.gradePh')} className="h-10 w-28" />
      <Button type="submit" size="sm" disabled={pending}>{pending ? t('stu.adding') : t('stu.addClass')}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{t('stu.cancelClass')}</Button>
      {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
    </form>
  )
}
