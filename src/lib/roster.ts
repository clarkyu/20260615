// SECURITY/SUPPLY-CHAIN: `xlsx` (SheetJS) is pinned in package.json to the
// vendor CDN tarball (cdn.sheetjs.com), not the npm registry — by SheetJS's own
// distribution model. It's integrity-locked in package-lock.json, but `npm audit`
// won't see it and updates are a manual URL bump. Review releases periodically.
import * as XLSX from 'xlsx'

export interface RosterRow {
  rowNumber: number
  studentNo: string
  name: string
  className: string
  department?: string
  major?: string
  grade?: string
  phone?: string
  email?: string
  error?: string
}

type Field = 'studentNo' | 'name' | 'className' | 'department' | 'major' | 'grade' | 'phone' | 'email'

// Accept either Chinese or English headers, case/space-insensitive.
const HEADER_ALIASES: Record<Field, string[]> = {
  studentNo: ['学号', 'studentno', 'student no', 'student id', 'id', '学籍号', '考号'],
  name: ['姓名', 'name', '学生姓名'],
  className: ['班级', 'class', 'classname', '行政班', '班级名称', '教学班'],
  department: ['院系', 'department', 'dept', '系', '学院', '系部'],
  major: ['专业', 'major', 'majorname'],
  grade: ['年级', 'grade', '级', '入学年份', 'year', '届'],
  phone: ['手机号', '手机', '电话', '联系电话', 'phone', 'mobile', 'tel'],
  email: ['邮箱', '电子邮箱', '邮件', 'email', 'e-mail', 'mail'],
}

function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, '')
}

type ColMap = Partial<Record<Field, number>>

function mapHeaderRow(row: string[]): ColMap {
  const map: ColMap = {}
  row.forEach((cell, idx) => {
    const text = norm(cell)
    if (!text) return
    for (const field of Object.keys(HEADER_ALIASES) as Field[]) {
      if (map[field] == null && HEADER_ALIASES[field].some((a) => norm(a) === text)) map[field] = idx
    }
  })
  return map
}

export interface ParsedRoster {
  rows: RosterRow[]
  validCount: number
  errorCount: number
  headerError?: string
}

function toUint8(buffer: ArrayBuffer | Uint8Array): Uint8Array {
  if (buffer instanceof Uint8Array) return buffer
  return new Uint8Array(buffer)
}

// "专科2025无人机应用技术2531321区队" -> "2531321" (longest 6+ digit run = 班号).
// Names without such a code are left untouched.
export function shortClassName(raw: string): string {
  const runs = raw.match(/\d{6,}/g)
  if (!runs || runs.length === 0) return raw.trim()
  return runs.reduce((a, b) => (b.length >= a.length ? b : a))
}

// "...2025无人机应用技术2531321区队" -> "无人机应用技术" (between year and 班号).
export function extractMajor(raw: string): string | undefined {
  const m = raw.match(/(?:专科|本科|高职|中职|高级|中级)?\s*\d{4}\s*([一-龥]+?)\s*\d{6,}/)
  return m && m[1] ? m[1] : undefined
}

// "专科2025无人机应用技术..." -> "2025" (cohort year / 年级). A bare 2-digit
// "23级" is normalised to "2023".
export function extractGrade(raw: string): string | undefined {
  const full = raw.match(/(19|20)\d{2}/)
  if (full) return full[0]
  const two = raw.match(/(\d{2})\s*级/)
  if (two) return `20${two[1]}`
  return undefined
}

export function parseRoster(buffer: ArrayBuffer | Uint8Array): ParsedRoster {
  try {
    return parseRosterUnsafe(buffer)
  } catch (err) {
    console.error('[parseRoster] failed:', err)
    return { rows: [], validCount: 0, errorCount: 0, headerError: 'roster.errParse' }
  }
}

function parseRosterUnsafe(buffer: ArrayBuffer | Uint8Array): ParsedRoster {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(toUint8(buffer), { type: 'array' })
  } catch {
    return { rows: [], validCount: 0, errorCount: 0, headerError: 'roster.errRead' }
  }
  const sheetName = wb.SheetNames[0]
  const ws = sheetName ? wb.Sheets[sheetName] : undefined
  if (!ws) return { rows: [], validCount: 0, errorCount: 0, headerError: 'roster.errSheet' }

  const grid = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '', blankrows: false })

  // Find the header row: title/metadata rows may sit above it.
  let headerIdx = -1
  let colMap: ColMap = {}
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const map = mapHeaderRow(grid[i] ?? [])
    if (map.studentNo != null && map.name != null && map.className != null) {
      headerIdx = i
      colMap = map
      break
    }
  }
  if (headerIdx < 0) {
    return { rows: [], validCount: 0, errorCount: 0, headerError: 'roster.errColumns' }
  }

  const get = (row: string[], field: Field): string =>
    colMap[field] != null ? String(row[colMap[field]!] ?? '').trim() : ''

  const rows: RosterRow[] = []
  const seen = new Set<string>()
  let validCount = 0
  let errorCount = 0

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r] ?? []
    const studentNo = get(row, 'studentNo')
    const name = get(row, 'name')
    const rawClass = get(row, 'className')
    const className = shortClassName(rawClass)
    const department = get(row, 'department') || undefined
    const major = get(row, 'major') || extractMajor(rawClass)
    const grade = get(row, 'grade') || extractGrade(rawClass)
    const phone = get(row, 'phone') || undefined
    const email = get(row, 'email').toLowerCase() || undefined
    if (!studentNo && !name && !rawClass) continue

    // Row-level errors are i18n KEYS (translated in the import preview), not display
    // text — so en/es users see the reason in their own language, not Chinese.
    let error: string | undefined
    if (!studentNo) error = 'roster.rowNoStudentNo'
    else if (!name) error = 'roster.rowNoName'
    else if (!className) error = 'roster.rowNoClass'
    else if (seen.has(studentNo)) error = 'roster.rowDupNo'
    if (studentNo) seen.add(studentNo)

    if (error) errorCount++
    else validCount++
    rows.push({ rowNumber: r + 1, studentNo, name, className, department, major, grade, phone, email, error })
  }

  return { rows, validCount, errorCount }
}

export interface ScoreExportRow {
  studentNo: string
  name: string
  className: string
  status: string
  aiScore: number | null
  finalScore: number | null
  // Per-graded-phase final scores, aligned to the `phaseLabels` passed to
  // buildScoreWorkbook. Only set for multi-phase exports; empty/missing → blank cells.
  phaseScores?: (number | null)[]
  feedback: string
  gradedAt: string
}

export interface GradebookRow {
  studentNo: string
  name: string
  daily: number | null // 平时成绩
  exam: number | null // 测试成绩
  done: string // 完成度, e.g. "3/5"
}

export function buildGradebookWorkbook(className: string, rows: GradebookRow[]): Uint8Array {
  const header = ['学号 ID', '姓名 Name', '平时成绩 Daily', '测试成绩 Test', '完成度 Done']
  const aoa: (string | number | null)[][] = [
    header,
    ...rows.map((r) => [r.studentNo, r.name, r.daily, r.exam, r.done]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, (className || '成绩单').slice(0, 31))
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

// `phaseLabels` (when non-empty) inserts one score column per graded phase between
// 状态 and AI, and relabels the single score column as a mean — so a multi-phase
// assignment shows the per-phase breakdown instead of one opaque averaged number.
export function buildScoreWorkbook(className: string, rows: ScoreExportRow[], phaseLabels: string[] = []): Uint8Array {
  const multi = phaseLabels.length > 0
  const finalHeader = multi ? '总分·各环节均分 Mean' : '最终得分 Final'
  const header = [
    '学号 ID', '姓名 Name', '班级 Class', '状态 Status',
    ...phaseLabels.map((t, i) => t || `环节${i + 1}`),
    'AI 评分 AI', finalHeader, '评语 Feedback', '评阅时间 Graded at',
  ]
  const aoa: (string | number | null)[][] = [
    header,
    ...rows.map((r) => [
      r.studentNo, r.name, r.className, r.status,
      ...phaseLabels.map((_, i) => r.phaseScores?.[i] ?? null),
      r.aiScore, r.finalScore, r.feedback, r.gradedAt,
    ]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, ...phaseLabels.map(() => ({ wch: 8 })), { wch: 8 }, { wch: 10 }, { wch: 48 }, { wch: 18 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, (className || '成绩').slice(0, 31))
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}
