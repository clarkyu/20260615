// 学校平台成绩导出(domain):以学校教务平台下发的「成绩导入模板」为底,只回填三列成绩,
// 行/列一律不增不减不动(平台按行列严格校验,多一行少一列都导不进去)。
// 列映射(clark 定):平时成绩=课堂表现(雨课堂)、实验成绩=训练、期末成绩=期末考核;
// 模板无总评列,总评由学校平台按其配置比例自行合成。
// 取分=工作台当前生效分(auto + 改分/免计/填60,与老师屏幕所见一致),四舍五入取整。
import * as XLSX from 'xlsx'
import { categoryAuto, effectiveCategories, type ReviewCategoryKey } from './review'
import type { WorkbenchData } from './review-load'

export interface CategoryScores {
  classroom: number | null
  training: number | null
  final: number | null
}

// 逐生三类别生效分(取整)。EXEMPT/无数据 → null(模板格留空,不写 0——0 会被平台当真实分)。
export function buildExportScores(data: WorkbenchData): Map<string, CategoryScores> {
  const out = new Map<string, CategoryScores>()
  for (const s of data.students) {
    const no = s.no?.trim()
    if (!no) continue
    const cats = effectiveCategories(categoryAuto(s.inputs, data.config), s.overrides)
    const round = (x: number | null) => (x == null ? null : Math.round(x))
    out.set(no, { classroom: round(cats.classroom.fin), training: round(cats.training.fin), final: round(cats.final.fin) })
  }
  return out
}

export interface ExportReport {
  templateRows: number // 模板学生行数(不含表头)
  matchedRows: number // 学号能对上工作台花名册的行
  filledCells: number
  unmatched: { studentNo: string; name: string }[] // 模板有、我们无:格留空,行保留
  missing: { studentNo: string; name: string; cats: ReviewCategoryKey[] }[] // 匹配到但该类别无分:格留空
}

export type FillResult = { ok: true; out: Uint8Array; report: ExportReport } | { ok: false; error: string }

const norm = (v: unknown): string => String(v ?? '').trim()

// 回填模板:只改第一个工作表里三列成绩的单元格值,其余工作表/行/列原样带回。
// 表头在前 5 行内自动定位(须同时含「学号」「平时成绩」)。输出格式跟随模板扩展名。
export function fillSchoolTemplate(
  buffer: ArrayBuffer | Uint8Array,
  fileName: string,
  scores: Map<string, CategoryScores>,
): FillResult {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), { type: 'array' })
  } catch {
    return { ok: false, error: 'rexp.errRead' }
  }
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws || !ws['!ref']) return { ok: false, error: 'rexp.errRead' }
  const range = XLSX.utils.decode_range(ws['!ref'])
  const cellText = (r: number, c: number) => norm(ws[XLSX.utils.encode_cell({ r, c })]?.v)

  // 定位表头行与列
  let headerRow = -1
  let cNo = -1
  let cName = -1
  let cDaily = -1
  let cLab = -1
  let cFinal = -1
  for (let r = range.s.r; r <= Math.min(range.s.r + 4, range.e.r) && headerRow < 0; r++) {
    let no = -1
    let daily = -1
    for (let c = range.s.c; c <= range.e.c; c++) {
      const t = cellText(r, c)
      if (t === '学号') no = c
      if (t === '平时成绩') daily = c
    }
    if (no >= 0 && daily >= 0) {
      headerRow = r
      cNo = no
      cDaily = daily
      for (let c = range.s.c; c <= range.e.c; c++) {
        const t = cellText(r, c)
        if (t === '姓名') cName = c
        if (t === '实验成绩') cLab = c
        if (t === '期末成绩') cFinal = c
      }
    }
  }
  if (headerRow < 0 || cFinal < 0) return { ok: false, error: 'rexp.errHeader' }

  const report: ExportReport = { templateRows: 0, matchedRows: 0, filledCells: 0, unmatched: [], missing: [] }
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const no = cellText(r, cNo)
    if (!no) continue
    report.templateRows++
    const name = cName >= 0 ? cellText(r, cName) : ''
    const s = scores.get(no)
    if (!s) {
      report.unmatched.push({ studentNo: no, name })
      continue
    }
    report.matchedRows++
    const missingCats: ReviewCategoryKey[] = []
    const put = (c: number, key: ReviewCategoryKey, v: number | null) => {
      if (c < 0) return // 模板没这列就不填(实验成绩列有的模板可能缺)
      if (v == null) {
        missingCats.push(key)
        return
      }
      ws[XLSX.utils.encode_cell({ r, c })] = { t: 'n', v }
      report.filledCells++
    }
    put(cDaily, 'classroom', s.classroom)
    put(cLab, 'training', s.training)
    put(cFinal, 'final', s.final)
    if (missingCats.length > 0) report.missing.push({ studentNo: no, name, cats: missingCats })
  }

  const bookType: XLSX.BookType = /\.xlsx$/i.test(fileName) ? 'xlsx' : 'biff8'
  const out = XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer
  return { ok: true, out: new Uint8Array(out), report }
}
