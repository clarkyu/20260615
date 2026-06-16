// Item-bank helpers. Pure + unit-tested; the server action only does I/O.

export interface ParsedChunk {
  english: string
  chinese: string | null
}

// Parses pasted bilingual text into chunks. Each non-empty line is one sentence;
// English and Chinese are separated by a tab or a vertical bar ("EN | 中文").
// A leading list number ("1.", "2、", "3)") on the English side is stripped.
export function parseBilingual(raw: string): ParsedChunk[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const sep = line.search(/\t|\|/)
      let english = line
      let chinese = ''
      if (sep >= 0) {
        english = line.slice(0, sep).trim()
        chinese = line.slice(sep + 1).replace(/\|/g, ' ').trim()
      }
      english = english.replace(/^\s*\d+\s*[.、)）]\s*/, '').trim()
      return { english, chinese: chinese || null }
    })
    .filter((c) => c.english.length > 0)
}
