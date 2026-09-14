// CSV 序列化(SPEC §8「全部可导出 CSV」,验收「Excel 直接打开且中文不乱码」):
// UTF-8 BOM + CRLF 行尾;含逗号 / 引号 / 换行的字段加引号并把引号翻倍;以 = + - @ 开头的字段
// 前置单引号防公式注入。纯函数。

export const CSV_BOM = '\uFEFF'

export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** Excel 友好:BOM 开头。 */
export function toCsvWithBom(rows: unknown[][]): string {
  return CSV_BOM + toCsv(rows)
}

/** Content-Disposition 里的中文文件名(RFC 5987)。 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
