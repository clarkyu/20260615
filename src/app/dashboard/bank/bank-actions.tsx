'use client'

import { useState } from 'react'
import { Plus, FilePlus2, Sparkles, PackagePlus, BookOpen } from 'lucide-react'
import { importStarterBank, importEnglishFlow } from '@/actions/bank'
import { useT } from '@/components/i18n-provider'
import { Button } from '@/components/ui/button'
import { useChunkedImport } from './use-chunked-import'
import { CreateSetForm } from './create-set-form'
import { ImportPackForm } from './import-pack-form'

// Single entry point for all bank create/import actions — one "新建 / 导入"
// dropdown instead of a row of buttons. Built-in imports run via the chunked
// (resumable) hook; create / pack open an inline panel below.
export function BankActions({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const t = useT()
  const [menu, setMenu] = useState(false)
  const [panel, setPanel] = useState<null | 'create' | 'pack'>(null)
  const { run, pending, msg } = useChunkedImport()

  const items = [
    { icon: FilePlus2, label: t('bank.newSet'), act: () => setPanel('create') },
    { icon: Sparkles, label: t('bank.importStarter'), act: () => run(importStarterBank) },
    ...(isSuperAdmin
      ? [
          { icon: PackagePlus, label: t('pack.new'), act: () => setPanel('pack') },
          { icon: BookOpen, label: t('bank.importFlow'), act: () => run(importEnglishFlow) },
        ]
      : []),
  ]

  return (
    <div className="space-y-3">
      <div className="relative inline-block">
        <Button size="sm" onClick={() => setMenu((v) => !v)} disabled={pending}>
          <Plus className="h-4 w-4" />{pending ? t('bank.importing') : t('bank.addMenu')}
        </Button>
        {menu ? (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
            <div className="absolute left-0 z-20 mt-1 w-60 overflow-hidden rounded-xl border border-input bg-background shadow-lg">
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
      {panel === 'create' ? <CreateSetForm canPublishGlobal={isSuperAdmin} onClose={() => setPanel(null)} /> : null}
      {panel === 'pack' ? <ImportPackForm onClose={() => setPanel(null)} /> : null}
    </div>
  )
}
