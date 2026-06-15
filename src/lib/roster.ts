import * as XLSX from 'xlsx'

export interface RosterRow {
  rowNumber: number
  studentNo: string
  name: string
  className: string
  department?: string
  major?: string
  error?: string
}

type Field = 'studentNo' | 'name' | 'className' | 'department' | 'major'

// Accept either Chinese or English headers, case/space-insensitive.
const HEADER_ALIASES: Record<Field, string[]> = {
  studentNo: ['学号', 'studentno', 'student no', 'student id', 'id', '学籍号', '考号'],
  name: ['姓名', 'name', '学生姓名'],
  className: ['班级', 'class', 'classname', '行政班', '班级名称', '教学班'],
  department: ['院系', 'department', 'dept', '系', '学院'],
  major: ['专业', 'major', 'majorname'],
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

function toUint8(buffer: ArrayBuffer | Buffer): Uint8Array {
  if (buffer instanceof Uint8Array) return buffer
  return new Uint8Array(buffer)
}

export function parseRoster(buffer: ArrayBuffer | Buffer): ParsedRoster {
  try {
    return parseRosterUnsafe(buffer)
  } catch (err) {
    console.error('[parseRoster] failed:', err)
    return { rows: [], validCount: 0, errorCount: 0, headerError: '解析文件出错，请确认是有效的 .xls / .xlsx 名单。' }
  }
}

function parseRosterUnsafe(buffer: ArrayBuffer | Buffer): ParsedRoster {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(toUint8(buffer), { type: 'array' })
  } catch {
    return { rows: [], validCount: 0, errorCount: 0, headerError: '无法读取该文件，请上传 .xls 或 .xlsx' }
  }
  const sheetName = wb.SheetNames[0]
  const ws = sheetName ? wb.Sheets[sheetName] : undefined
  if (!ws) return { rows: [], validCount: 0, errorCount: 0, headerError: '找不到工作表' }

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
    return { rows: [], validCount: 0, errorCount: 0, headerError: '缺少必需列：学号、姓名、班级 / Missing required columns: ID, Name, Class' }
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
    const className = get(row, 'className')
    const department = get(row, 'department') || undefined
    const major = get(row, 'major') || undefined
    if (!studentNo && !name && !className) continue

    let error: string | undefined
    if (!studentNo) error = '学号为空'
    else if (!name) error = '姓名为空'
    else if (!className) error = '班级为空'
    else if (seen.has(studentNo)) error = '学号在表内重复'
    if (studentNo) seen.add(studentNo)

    if (error) errorCount++
    else validCount++
    rows.push({ rowNumber: r + 1, studentNo, name, className, department, major, error })
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
  feedback: string
  gradedAt: string
}

export function buildScoreWorkbook(className: string, rows: ScoreExportRow[]): Uint8Array {
  const header = ['学号 ID', '姓名 Name', '班级 Class', '状态 Status', 'AI 评分 AI', '最终得分 Final', '评语 Feedback', '评阅时间 Graded at']
  const aoa: (string | number | null)[][] = [
    header,
    ...rows.map((r) => [r.studentNo, r.name, r.className, r.status, r.aiScore, r.finalScore, r.feedback, r.gradedAt]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 48 }, { wch: 18 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, (className || '成绩').slice(0, 31))
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}
