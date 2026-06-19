'use client'

import { useActionState, useEffect, useRef } from 'react'
import { Send } from 'lucide-react'
import { submitFeedback } from '@/actions/feedback'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'

export function FeedbackForm() {
  const t = useT()
  const [state, action, pending] = useActionState(submitFeedback, null)
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => { if (state?.success) ref.current?.reset() }, [state])

  return (
    <Card>
      <CardContent className="p-4">
        <form ref={ref} action={action} className="space-y-3">
          <Textarea name="body" rows={4} required maxLength={5000} placeholder={t('fb.placeholder')} aria-label={t('fb.placeholder')} />
          {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
          {state?.success ? <FormMessage tone="success">{t('fb.thanks')}</FormMessage> : null}
          <Button type="submit" disabled={pending} size="lg" className="w-full">
            <Send className="h-4 w-4" />{pending ? t('fb.sending') : t('fb.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
