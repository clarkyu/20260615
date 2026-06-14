import ExcelJS from 'exceljs'

export interface RosterRow {
  rowNumber: number
  studentNo: string
  name: string
  className: string
  department?: string
  major?: string
  error?: string
}

// Accept either Chinese or English headers, case/space-insensitive.
const HEADER_ALIASES: Record<keyof Omit<RosterRow, 'rowNumber' | 'error'>, string[]> = {
  studentNo: ['学号', 'studentno', 'student no', 'student id', 'id', '学籍号'],
  name: ['姓名', 'name', '学生姓名'],
  className: ['班级', 'class', 'classname', '行政班', '班级名称'],
  department: ['院系', 'department', 'dept', '系', '学院'],
  major: ['专业', 'major', 'majorname'],
}

function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, '')
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text.trim()
  if (typeof value === 'object' && 'result' in value) return String(value.result ?? '').trim()
  return String(value).trim()
}

export interface ParsedRoster {
  rows: RosterRow[]
  validCount: number
  errorCount: number
  headerError?: string
}

export async function parseRoster(buffer: ArrayBuffer | Buffer): Promise<ParsedRoster> {
  const wb = new ExcelJS.Workbook()
  const data = buffer instanceof ArrayBuffer ? Buffer.from(new Uint8Array(buffer)) : buffer
  await wb.xlsx.load(data as unknown as Parameters<typeof wb.xlsx.load>[0])
  const ws = wb.worksheets[0]
  if (!ws) return { rows: [], validCount: 0, errorCount: 0, headerError: '找不到工作表' }

  // Locate the header row + which column maps to which field.
  const headerRow = ws.getRow(1)
  const colMap: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {}
  headerRow.eachCell((cell, colNumber) => {
    const text = norm(cellText(cell.value))
    for (const field of Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]) {
      if (HEADER_ALIASES[field].some((alias) => norm(alias) === text)) colMap[field] = colNumber
    }
  })

  const missing: string[] = []
  if (!colMap.studentNo) missing.push('学号')
  if (!colMap.name) missing.push('姓名')
  if (!colMap.className) missing.push('班级')
  if (missing.length) {
    return { rows: [], validCount: 0, errorCount: 0, headerError: `缺少必需列：${missing.join('、')}` }
  }

  const rows: RosterRow[] = []
  const seen = new Set<string>()
  let validCount = 0
  let errorCount = 0

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const get = (field: keyof typeof HEADER_ALIASES) =>
      colMap[field] ? cellText(row.getCell(colMap[field]!).value) : ''

    const studentNo = get('studentNo')
    const name = get('name')
    const className = get('className')
    const department = get('department') || undefined
    const major = get('major') || undefined

    if (!studentNo && !name && !className) continue // skip blank lines

    let error: string | undefined
    if (!studentNo) error = '学号为空'
    else if (!name) error = '姓名为空'
    else if (!className) error = '班级为空'
    else if (seen.has(studentNo)) error = '学号在表内重复'
    if (studentNo) seen.add(studentNo)

    if (error) errorCount++
    else validCount++
    rows.push({ rowNumber: r, studentNo, name, className, department, major, error })
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

export async function buildScoreWorkbook(className: string, rows: ScoreExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(className.slice(0, 31) || '成绩')
  ws.columns = [
    { header: '学号', key: 'studentNo', width: 16 },
    { header: '姓名', key: 'name', width: 12 },
    { header: '班级', key: 'className', width: 16 },
    { header: '状态', key: 'status', width: 10 },
    { header: 'AI 评分', key: 'aiScore', width: 10 },
    { header: '最终得分', key: 'finalScore', width: 10 },
    { header: '评语', key: 'feedback', width: 50 },
    { header: '评阅时间', key: 'gradedAt', width: 20 },
  ]
  ws.getRow(1).font = { bold: true }
  ws.addRows(rows)
  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out)
}
