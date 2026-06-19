import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { extractGrade, extractMajor, shortClassName, parseRoster, buildScoreWorkbook, type ScoreExportRow } from '../roster'

function buildXlsx(aoa: (string | number)[][]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

function readSheet(buf: Uint8Array): unknown[][] {
  const wb = XLSX.read(buf, { type: 'array' })
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false })
}

describe('roster field extraction', () => {
  it('pulls the cohort year (年级) from a class name', () => {
    expect(extractGrade('专科2025无人机应用技术2531321区队')).toBe('2025')
    expect(extractGrade('本科2023级软件工程1班')).toBe('2023')
  })

  it('normalises a bare "23级" to a 4-digit year', () => {
    expect(extractGrade('软件23级2班')).toBe('2023')
  })

  it('returns undefined when there is no year', () => {
    expect(extractGrade('无人机区队')).toBeUndefined()
  })

  it('does not mistake a 班号 digit run for a year', () => {
    expect(extractGrade('2531321')).toBeUndefined()
  })

  it('still extracts 班号 and major alongside the year', () => {
    const raw = '专科2025无人机应用技术2531321区队'
    expect(shortClassName(raw)).toBe('2531321')
    expect(extractMajor(raw)).toBe('无人机应用技术')
  })
})

describe('roster failure detail', () => {
  it('flags each bad row with an i18n key and the right Excel row number', () => {
    const buf = buildXlsx([
      ['学号', '姓名', '班级'], // row 1 — header
      ['001', '张三', '一班'], //  row 2 — valid
      ['', '李四', '一班'], //     row 3 — missing 学号
      ['003', '', '一班'], //      row 4 — missing 姓名
      ['001', '王五', '一班'], //  row 5 — duplicate 学号
    ])
    const parsed = parseRoster(buf)

    expect(parsed.headerError).toBeUndefined()
    expect(parsed.validCount).toBe(1)
    expect(parsed.errorCount).toBe(3)

    const good = parsed.rows.find((r) => r.name === '张三')
    expect(good?.error).toBeUndefined()
    expect(good?.rowNumber).toBe(2)

    // Reasons are i18n KEYS, not Chinese display text — the preview translates them.
    expect(parsed.rows.find((r) => r.name === '李四')?.error).toBe('roster.rowNoStudentNo')
    expect(parsed.rows.find((r) => r.studentNo === '003')?.error).toBe('roster.rowNoName')

    const dup = parsed.rows.find((r) => r.name === '王五')
    expect(dup?.error).toBe('roster.rowDupNo')
    expect(dup?.rowNumber).toBe(5)
  })
})

describe('buildScoreWorkbook', () => {
  const base: ScoreExportRow = { studentNo: '001', name: 'A', className: '1班', status: '已评阅', aiScore: 80, finalScore: 85, feedback: 'good', gradedAt: '2026-06-19 10:00' }

  it('uses the flat 8-column layout for a single-phase export', () => {
    const aoa = readSheet(buildScoreWorkbook('1班', [base]))
    expect(aoa[0]).toEqual(['学号 ID', '姓名 Name', '班级 Class', '状态 Status', 'AI 评分 AI', '最终得分 Final', '评语 Feedback', '评阅时间 Graded at'])
  })

  it('adds a column per phase and relabels the total as a mean when multi-phase', () => {
    const aoa = readSheet(buildScoreWorkbook('1班', [{ ...base, phaseScores: [80, 90] }], ['朗读', '背诵']))
    const header = aoa[0] as string[]
    expect(header).toEqual(['学号 ID', '姓名 Name', '班级 Class', '状态 Status', '朗读', '背诵', 'AI 评分 AI', '总分·各环节均分 Mean', '评语 Feedback', '评阅时间 Graded at'])
    // the two per-phase scores sit between 状态 and AI; the mean total stays after AI.
    expect(aoa[1]).toEqual(['001', 'A', '1班', '已评阅', 80, 90, 80, 85, 'good', '2026-06-19 10:00'])
  })

  it('keeps AI/total columns aligned when a student is missing a phase score', () => {
    const row = readSheet(buildScoreWorkbook('1班', [{ ...base, phaseScores: [80, null] }], ['朗读', '背诵']))[1] as unknown[]
    expect(row[4]).toBe(80) // 朗读
    expect(row[6]).toBe(80) // AI — still right after the two phase columns despite the blank 背诵
    expect(row[7]).toBe(85) // 总分
  })
})
