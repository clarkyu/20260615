'use client'

import { useState, useTransition } from 'react'
import { Link2, Copy, Check } from 'lucide-react'
import { createSchoolInvite } from '@/actions/staff'
import { useT } from '@/components/i18n-provider'
import { Button } from '@/components/ui/button'

// School-admin: generate a single-use, 7-day invite link to copy + send to a new teacher.
export function InviteTeacher() {
  const t = useT()
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, start] = useTransition()

  function generate() {
    start(async () => {
      const res = await createSchoolInvite()
      if (res.url) { setUrl(res.url); setCopied(false) }
    })
  }
  async function copy() {
    if (!url) return
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ }
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={generate} disabled={pending}>
        <Link2 className="h-4 w-4" />{pending ? t('loading') : t('teacher.invite')}
      </Button>
      {url ? (
        <>
          <div className="flex items-center gap-2 rounded-xl border border-input bg-secondary/40 p-2 text-xs">
            <span className="min-w-0 flex-1 truncate font-mono">{url}</span>
            <Button size="sm" variant="ghost" onClick={copy}>{copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}</Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('teacher.inviteHint')}</p>
        </>
      ) : null}
    </div>
  )
}
