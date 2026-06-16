'use client'

import { CEFR_LEVELS, STRANDS, DOMAINS } from '@/lib/curriculum/taxonomy'
import { useT } from '@/components/i18n-provider'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'

const SELECT = 'h-11 w-full rounded-xl border border-input bg-background px-3 text-sm'
const speakingStrands = STRANDS.filter((s) => s.parent === 'english.speaking')

// Curriculum classification for a bank set — shared by create + edit forms.
export function BankMetaFields({
  cefr,
  strand,
  domain,
  tags,
  source,
}: {
  cefr?: string | null
  strand?: string | null
  domain?: string | null
  tags?: string | null
  source?: string | null
}) {
  const t = useT()
  return (
    <div className="space-y-3 rounded-xl border border-input p-3">
      <p className="text-xs font-medium text-muted-foreground">{t('bank.meta')}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cefr">{t('bank.level')}</Label>
          <select id="cefr" name="cefr" defaultValue={cefr ?? ''} className={SELECT}>
            <option value="">—</option>
            {CEFR_LEVELS.map((l) => <option key={l.band} value={l.band}>{l.label} · {l.note}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="strand">{t('bank.skill')}</Label>
          <select id="strand" name="strand" defaultValue={strand ?? ''} className={SELECT}>
            <option value="">—</option>
            {speakingStrands.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="domain">{t('bank.domain')}</Label>
          <select id="domain" name="domain" defaultValue={domain ?? ''} className={SELECT}>
            <option value="">—</option>
            {DOMAINS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="source">{t('bank.source')}</Label>
          <Input id="source" name="source" defaultValue={source ?? ''} placeholder="—" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tags">{t('bank.tags')}</Label>
        <Input id="tags" name="tags" defaultValue={tags ?? ''} placeholder={t('bank.tagsPh')} />
      </div>
    </div>
  )
}
