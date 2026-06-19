'use client'

import { useEffect, useState } from 'react'
import { Plus, FilePlus2, Sparkles, PackagePlus, BookOpen, Languages } from 'lucide-react'
import { importStarterBank, importEnglishFlow, refreshEnglishFlow } from '@/actions/bank'
import { useT } from '@/components/i18n-provider'
import { Button } from '@/components/ui/button'
import { useChunkedImport } from './use-chunked-import'
import { CreateSetForm } from './create-set-form'
import { ImportPackForm } from './import-pack-form'

// Bank create/import entry. A teacher only needs to make their own set — the
// official content is already globally visible, and a teacher "import" would just
// duplicate it — so teachers get a single "新建句集" button. A super-admin curates
// the global pool, so they get the full "新建 / 导入" menu.
export function BankActions({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const t = useT()
  const [menu, setMenu] = useState(false)
  const [panel, setPanel] = useState<null | 'create' | 'pack'>(null)
  const { run, pending, msg } = useChunkedImport()

  // Escape closes the open menu — keyboard users aren't stuck relying on a
  // mouse click outside (the backdrop) to dismiss it.
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu])

  if (!isSuperAdmin) {
    return (
      <div className="space-y-3">
        {panel !== 'create' ? (
          <Button size="sm" variant="outline" onClick={() => setPanel('create')}>
            <Plus className="h-4 w-4" />{t('bank.newSet')}
          </Button>
        ) : null}
        {panel === 'create' ? <CreateSetForm canPublishGlobal={false} onClose={() => setPanel(null)} /> : null}
      </div>
    )
  }

  const items = [
    { icon: FilePlus2, label: t('bank.newSet'), act: () => setPanel('create') },
    { icon: Sparkles, label: t('bank.importStarter'), act: () => run(importStarterBank) },
    { icon: PackagePlus, label: t('pack.new'), act: () => setPanel('pack') },
    { icon: BookOpen, label: t('bank.importFlow'), act: () => run(importEnglishFlow) },
    { icon: Languages, label: t('bank.refreshFlow'), act: () => run(refreshEnglishFlow) },
  ]

  return (
    <div className="space-y-3">
      <div className="relative inline-block">
        <Button size="sm" onClick={() => setMenu((v) => !v)} disabled={pending} aria-haspopup="true" aria-expanded={menu}>
          <Plus className="h-4 w-4" />{pending ? t('bank.importing') : t('bank.addMenu')}
        </Button>
        {menu ? (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} aria-hidden="true" />
            <div className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-xl border border-input bg-background shadow-lg">
              {items.map((it) => (
                <button
                  key={it.label}
                  type="button"
                  onClick={() => { setMenu(false); it.act() }}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm hover:bg-secondary"
                >
                  <it.icon className="h-4 w-4 shrink-0 text-muted-foreground" />{it.label}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
      {panel === 'create' ? <CreateSetForm canPublishGlobal onClose={() => setPanel(null)} /> : null}
      {panel === 'pack' ? <ImportPackForm onClose={() => setPanel(null)} /> : null}
    </div>
  )
}
