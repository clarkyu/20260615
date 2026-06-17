'use client'

import { useEffect, useState } from 'react'
import { Languages } from 'lucide-react'
import { useT } from '@/components/i18n-provider'

// Bilingual display for bank chunks (中心句 / 解释句 / 情景例句). One control,
// three modes — English only, Chinese only, or both — shared by the student
// shadowing view and the teacher bank/preview screens. When a Chinese field is
// missing (not translated yet), Chinese/both modes fall back to the English so the
// learner always sees something.

export type ChunkLang = 'en' | 'zh' | 'both'

export interface BiChunk {
  english: string
  chinese: string | null
  meaningEn: string | null
  meaningZh: string | null
  exampleEn: string | null
  exampleZh: string | null
}

const KEY = 'chunkLang'
const isLang = (v: unknown): v is ChunkLang => v === 'en' || v === 'zh' || v === 'both'

// Remembers the reader's choice across pages/sessions (localStorage).
export function useChunkLang(): [ChunkLang, (v: ChunkLang) => void] {
  const [lang, setLang] = useState<ChunkLang>('both')
  useEffect(() => {
    try { const v = localStorage.getItem(KEY); if (isLang(v)) setLang(v) } catch { /* ignore */ }
  }, [])
  const set = (v: ChunkLang) => {
    setLang(v)
    try { localStorage.setItem(KEY, v) } catch { /* ignore */ }
  }
  return [lang, set]
}

export function ChunkLangToggle({ value, onChange, className = '' }: { value: ChunkLang; onChange: (v: ChunkLang) => void; className?: string }) {
  const t = useT()
  const opts: { v: ChunkLang; label: string }[] = [
    { v: 'en', label: t('lang.en') },
    { v: 'zh', label: t('lang.zh') },
    { v: 'both', label: t('lang.both') },
  ]
  return (
    <div className={`inline-flex items-center gap-0.5 rounded-lg bg-secondary p-0.5 text-xs ${className}`}>
      <Languages className="mx-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={`rounded-md px-2 py-1 font-medium transition ${value === o.v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// The English/Chinese to show for one field under a given mode. `b` is the muted
// second line (only in 'both', and only when both languages are present).
function pick(en: string | null, zh: string | null, lang: ChunkLang): { a: string | null; b: string | null } {
  if (lang === 'en') return { a: en, b: null }
  if (lang === 'zh') return { a: zh ?? en, b: null } // fall back to English when not translated
  return { a: en ?? zh, b: en && zh ? zh : null }
}

// One chunk's three parts (中心句 / 解释句 / 情景例句), rendered per mode.
export function BilingualChunk({ chunk, lang }: { chunk: BiChunk; lang: ChunkLang }) {
  const t = useT()
  const head = pick(chunk.english, chunk.chinese, lang)
  const meaning = pick(chunk.meaningEn, chunk.meaningZh, lang)
  const example = pick(chunk.exampleEn, chunk.exampleZh, lang)
  return (
    <div className="min-w-0 space-y-1">
      <div>
        <div className="font-semibold">{head.a}</div>
        {head.b ? <div className="text-xs text-muted-foreground">{head.b}</div> : null}
      </div>
      {meaning.a ? (
        <div className="text-xs">
          <span className="text-muted-foreground">{t('bank.meaning')}：</span>{meaning.a}
          {meaning.b ? <span className="text-muted-foreground"> / {meaning.b}</span> : null}
        </div>
      ) : null}
      {example.a ? (
        <div className="text-xs">
          <span className="text-muted-foreground">{t('bank.example')}：</span>{example.a}
          {example.b ? <span className="text-muted-foreground"> / {example.b}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

// A numbered, toggle-headed list of chunks — for the server-rendered teacher bank
// detail + assignment preview (they pass plain chunk rows; the toggle state lives here).
export function BilingualChunkList({ chunks, title }: { chunks: BiChunk[]; title?: string }) {
  const t = useT()
  const [lang, setLang] = useChunkLang()
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{title ?? t('bank.chunkList')}</h2>
        <ChunkLangToggle value={lang} onChange={setLang} />
      </div>
      <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60">
        {chunks.map((c, i) => (
          <div key={i} className="flex gap-3 p-3.5 text-sm">
            <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
            <BilingualChunk chunk={c} lang={lang} />
          </div>
        ))}
      </div>
    </div>
  )
}
