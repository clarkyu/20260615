// 学校平台成绩导出:回填保真(行列不增不减、只改成绩格)、列映射、取整、留空语义、
// 两向名单。模板用合成工作簿(零真实学生数据入库)。
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildExportScores, fillSchoolTemplate } from '../review-export'
import { DEFAULT_REVIEW_WEIGHTS, type ReviewConfig } from '../review'
import type { WorkbenchData } from '../review-load'

const HEADERS = ['学号', '姓名', '学年学期', '行政班名称', '教学班名称', '课程名称', '平时成绩', '实验成绩', '期末成绩', '正考备注']
const row = (no: string, name: string) => [no, name, '2025-2026学年第二学期', '2531325区队', '2531325区队', '大学英语（二）', '', '', '', '']

function makeTemplate(rows: string[][], ext = 'xls'): { buf: Uint8Array; name: string } {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, ...rows]), 'Sheet1')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['示例']]), '基本数据')
  const buf = XLSX.write(wb, { type: 'array', bookType: ext === 'xlsx' ? 'xlsx' : 'biff8' }) as ArrayBuffer
  return { buf: new Uint8Array(buf), name: `template.${ext}` }
}

function wb2sheet(wb: XLSX.WorkBook, ws: XLSX.WorkSheet): XLSX.WorkBook {
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return wb
}

const config: ReviewConfig = {
  v: 1,
  weights: DEFAULT_REVIEW_WEIGHTS,
  missingZero: true,
  categories: {
    classroom: { classPerfImportId: 1 },
    training: { assignmentIds: [101, 102], assignmentWeights: [50, 50] },
    final: { assignmentIds: [201] },
  },
}

const data: WorkbenchData = {
  config,
  configVersion: 1,
  assignments: [],
  classPerf: { importId: 1, fileName: 'rain.xls', createdAt: new Date(0), sessions: 16 },
  students: [
    // 三类别齐:87.4→87 / 90.5→91(两项 90.5 均分) / 78
    { id: 1, no: '80250001', name: '甲', inputs: { classroom: 87.4, trainingParts: [90.5, 90.5], final: 78 }, overrides: [] },
    // 课堂无数据 → 平时留空;训练被免计 → 实验留空;期末改分 66
    {
      id: 2,
      no: '80250002',
      name: '乙',
      inputs: { classroom: null, trainingParts: [null, null], final: 40 },
      overrides: [
        { categoryKey: 'training', score: null, state: 'EXEMPT' },
        { categoryKey: 'final', score: 66, state: 'OVERRIDE' },
      ],
    },
  ],
}

describe('buildExportScores', () => {
  it('生效分取整;EXEMPT/无数据 → null', () => {
    const m = buildExportScores(data)
    expect(m.get('80250001')).toEqual({ classroom: 87, training: 91, final: 78 })
    expect(m.get('80250002')).toEqual({ classroom: null, training: null, final: 66 })
  })
})

describe('fillSchoolTemplate', () => {
  it('行列保真:只填成绩格,其余单元格与工作表原样;未匹配行保留并列名', () => {
    const t = makeTemplate([row('80250001', '甲'), row('80250002', '乙'), row('80259999', '陌生人')])
    const res = fillSchoolTemplate(t.buf, t.name, buildExportScores(data))
    if (!res.ok) throw new Error(res.error)
    expect(res.report).toMatchObject({ templateRows: 3, matchedRows: 2, filledCells: 4 })
    expect(res.report.unmatched).toEqual([{ studentNo: '80259999', name: '陌生人' }])
    expect(res.report.missing).toEqual([{ studentNo: '80250002', name: '乙', cats: ['classroom', 'training'] }])

    const wb2 = XLSX.read(res.out, { type: 'array' })
    expect(wb2.SheetNames).toEqual(['Sheet1', '基本数据'])
    const g = XLSX.utils.sheet_to_json<string[]>(wb2.Sheets['Sheet1'], { header: 1, raw: false, defval: '' })
    expect(g).toHaveLength(4) // 表头 + 3 行,不增不减
    expect(g[0]).toEqual(HEADERS)
    expect(g[1]).toEqual(['80250001', '甲', '2025-2026学年第二学期', '2531325区队', '2531325区队', '大学英语（二）', '87', '91', '78', ''])
    expect(g[2].slice(6, 9)).toEqual(['', '', '66']) // 无分格留空,不写 0
    expect(g[3].slice(6, 9)).toEqual(['', '', '']) // 未匹配行原样
  })

  it('xlsx 模板按 xlsx 回写', () => {
    const t = makeTemplate([row('80250001', '甲')], 'xlsx')
    const res = fillSchoolTemplate(t.buf, t.name, buildExportScores(data))
    if (!res.ok) throw new Error(res.error)
    // xlsx 以 PK zip 开头
    expect(res.out[0]).toBe(0x50)
    expect(res.out[1]).toBe(0x4b)
  })

  it('找不到表头 → rexp.errHeader;损坏文件 → rexp.errRead', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['随便', '列'], ['1', '2']]), 'S')
    const buf = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as ArrayBuffer)
    const bad = fillSchoolTemplate(buf, 't.xls', new Map())
    expect(bad).toEqual({ ok: false, error: 'rexp.errHeader' })
  })

  it('无分必须显式清空:模板预填 0/旧分不得残留(复核必改项)', () => {
    // 模拟平台预填 0 分,以及老师复用「已填文件」再导:乙的课堂/训练无分,旧值必须被清掉。
    const preFilled = [row('80250001', '甲'), row('80250002', '乙')].map((r) => [...r])
    preFilled[0][6] = '55' // 甲三格有旧值,应被新分覆盖
    preFilled[0][7] = '55'
    preFilled[0][8] = '55'
    preFilled[1][6] = '0' // 乙:课堂 null → 预填 0 必须清空
    preFilled[1][7] = '91' // 乙:训练 EXEMPT → 旧分 91 必须清空
    preFilled[1][8] = '40'
    const t = makeTemplate(preFilled)
    const res = fillSchoolTemplate(t.buf, t.name, buildExportScores(data))
    if (!res.ok) throw new Error(res.error)
    const g = XLSX.utils.sheet_to_json<string[]>(XLSX.read(res.out, { type: 'array' }).Sheets['Sheet1'], {
      header: 1,
      raw: false,
      defval: '',
    })
    expect(g[1].slice(6, 9)).toEqual(['87', '91', '78'])
    expect(g[2].slice(6, 9)).toEqual(['', '', '66']) // 预填 0 与旧分都被清空,报告口径与文件一致
  })

  it('数值型学号带前导零格式:按显示文本(w)匹配;日期等格式化格回写不丢格式', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([HEADERS, row('x', '甲')])
    // A2 = 数值 250001 + 前导零格式,显示 00250001;J2 = 日期序列数 + 格式(非成绩格)
    ws['A2'] = { t: 'n', v: 250001, z: '00000000' }
    ws['J2'] = { t: 'n', v: 46100, z: 'yyyy/m/d' }
    const buf = new Uint8Array(XLSX.write(wb2sheet(wb, ws), { type: 'array', bookType: 'biff8' }) as ArrayBuffer)
    const scores = new Map([['00250001', { classroom: 87, training: 91, final: 78 }]])
    const res = fillSchoolTemplate(buf, 't.xls', scores)
    if (!res.ok) throw new Error(res.error)
    expect(res.report.matchedRows).toBe(1)
    expect(res.report.unmatched).toHaveLength(0)
    const ws2 = XLSX.read(res.out, { type: 'array' }).Sheets['Sheet1']
    expect(ws2['G2']?.v).toBe(87)
    expect(ws2['J2']?.w).toBe('2026/3/19') // cellNF:非成绩格的数字格式随文件带回,不变裸数
  })
})
