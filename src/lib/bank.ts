// Item-bank helpers. Pure + unit-tested; the server action only does I/O.

export interface ChunkInput {
  english: string // 中心句 EN (required)
  chinese: string | null
  meaningEn: string | null // 解释句
  meaningZh: string | null
  exampleEn: string | null // 情境例句
  exampleZh: string | null
}

// One bilingual line: "English | 中文" (or a tab). Chinese is optional.
function splitBilingual(line: string): { en: string; zh: string | null } {
  const sep = line.search(/\t|\|/)
  if (sep < 0) return { en: line.trim(), zh: null }
  return { en: line.slice(0, sep).trim(), zh: line.slice(sep + 1).replace(/\|/g, ' ').trim() || null }
}

// Parses pasted three-part chunks. Items are separated by a blank line; each item
// is up to 3 bilingual lines in order — 中心句 / 解释句 / 情境例句 — every line
// "English | 中文". Leading list numbers ("51.") and "Means:/Example:" style
// prefixes are tolerated.
// Reverse of parseChunks: render chunks back into the editable three-part paste
// text (3 lines per item, blank line between), so a teacher can fix/extend them.
export function serializeChunks(
  chunks: { english: string; chinese: string | null; meaningEn: string | null; meaningZh: string | null; exampleEn: string | null; exampleZh: string | null }[],
): string {
  const line = (en: string, zh: string | null) => (zh ? `${en} | ${zh}` : en)
  return chunks
    .map((c) => {
      const lines = [line(c.english, c.chinese)]
      if (c.meaningEn) lines.push(line(c.meaningEn, c.meaningZh))
      if (c.exampleEn) lines.push(line(c.exampleEn, c.exampleZh))
      return lines.join('\n')
    })
    .join('\n\n')
}

export function parseChunks(raw: string): ChunkInput[] {
  const out: ChunkInput[] = []
  for (const block of raw.split(/\n\s*\n+/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) continue
    const core = splitBilingual(lines[0].replace(/^\s*\d+\s*[.、)）]\s*/, ''))
    if (!core.en) continue
    const meaning = lines[1] ? splitBilingual(lines[1].replace(/^(means|解释|释义)\s*[:：]\s*/i, '')) : { en: '', zh: null }
    const example = lines[2] ? splitBilingual(lines[2].replace(/^(example|例句|例|情境例句)\s*[:：]\s*/i, '')) : { en: '', zh: null }
    out.push({
      english: core.en,
      chinese: core.zh,
      meaningEn: meaning.en || null,
      meaningZh: meaning.zh,
      exampleEn: example.en || null,
      exampleZh: example.zh,
    })
  }
  return out
}

// Stable short ascii key derived from any title (incl. CJK) — used to make a
// pack's set `source` idempotent across re-imports.
export function slugHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

export interface PackSetInput {
  name: string
  chunks: ChunkInput[]
  sourceKey: string
}

// Split a parsed pack into named sets of `perSet` chunks each (or a single set
// when perSet<=0 or it already fits). Names get a "· NNNN–MMMM" range suffix; a
// stable `sourceKey` keys each set for idempotent re-import.
export function splitIntoSets(name: string, chunks: ChunkInput[], perSet: number): PackSetInput[] {
  const slug = slugHash(name)
  if (perSet <= 0 || chunks.length <= perSet) {
    return [{ name, chunks, sourceKey: `pack:${slug}` }]
  }
  const sets: PackSetInput[] = []
  for (let i = 0; i < chunks.length; i += perSet) {
    const slice = chunks.slice(i, i + perSet)
    const from = String(i + 1).padStart(4, '0')
    const to = String(i + slice.length).padStart(4, '0')
    sets.push({ name: `${name} · ${from}–${to}`, chunks: slice, sourceKey: `pack:${slug}:${from}-${to}` })
  }
  return sets
}
