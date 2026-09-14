import mammoth from 'mammoth'
import TurndownService from 'turndown'

// docx → HTML(mammoth)→ Markdown(turndown)(SPEC §8 导入向导第一步)。
// 试卷里的空位常是「两侧多个空格的数字」或「一串空格」(附录 B),HTML/Markdown 会把连续空白折叠成
// 一个——这里在转 Markdown 前把 ≥2 个连续空格换成不间断空格,规则切分才能识别空位;校对页显示时
// 与普通空格无异。

export interface DocxResult {
  markdown: string
  warnings: string[]
}

export async function docxToMarkdown(buffer: Buffer): Promise<DocxResult> {
  const { value: html, messages } = await mammoth.convertToHtml({ buffer })
  const preserved = html.replace(/ {2,}/g, (m) => ' '.repeat(m.length))
  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', emDelimiter: '_' })
  const markdown = td.turndown(preserved).replace(/\r\n?/g, '\n')
  return { markdown, warnings: messages.map((m) => `${m.type}: ${m.message}`) }
}

export const MAX_DOCX_BYTES = 8 * 1024 * 1024
