'use client'

import { useState, useTransition } from 'react'
import { Link2, Copy, Check, X } from 'lucide-react'
import { createSchoolInvite, revokeSchoolInvite } from '@/actions/staff'
import { useT } from '@/components/i18n-provider'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm'
import { LocalDate } from '@/components/local-date'

type PendingInvite = { id: number; expiresAt: string }

// School-admin: generate a single-use, 7-day invite link, and view/revoke pending ones.
export function InviteTeacher({ pending = [] }: { pending?: PendingInvite[] }) {
  const t = useT()
  const confirm = useConfirm()
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pendingGen, startGen] = useTransition()
  const [revoking, startRevoke] = useTransition()

  function generate() {
    startGen(async () => {
      const res = await createSchoolInvite()
      if (res.url) { setUrl(res.url); setCopied(false) }
    })
  }
  async function copy() {
    if (!url) return
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ }
  }
  async function revoke(id: number) {
    if (!(await confirm({ body: t('teacher.revokeConfirm'), danger: true }))) return
    startRevoke(async () => {
      const fd = new FormData()
      fd.set('inviteId', String(id))
      await revokeSchoolInvite(fd)
    })
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={generate} disabled={pendingGen}>
        <Link2 className="h-4 w-4" />{pendingGen ? t('loading') : t('teacher.invite')}
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

      {pending.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t('teacher.pendingInvites')}（{pending.length}）</p>
          {pending.map((inv) => (
            <div key={inv.id} className="flex items-center gap-2 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs">
              <span className="flex-1 text-muted-foreground">{t('teacher.inviteExpiresAt')} <LocalDate iso={inv.expiresAt} /></span>
              <button type="button" onClick={() => revoke(inv.id)} disabled={revoking} className="tap inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-destructive hover:bg-destructive/10">
                <X className="h-3.5 w-3.5" />{t('teacher.revoke')}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
