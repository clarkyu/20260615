import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseRainClassroom } from '@/lib/rain-classroom'

// 用 SheetJS 现造合成工作簿(仿 2531320 班真实结构;仓库里不放任何真实学生数据)。
// 结构:Sheet1 汇总(行1=计次节标题组表头,行2=列头「开课2次」,行3+=学生,含 1 个重复学号);
// 3 张明细表:01/02 计次,「02…（2）」是重开课(不在组表头标题集合里,带全角(2)后缀)→不计次。
function buildWorkbook() {
  const wb = XLSX.utils.book_new()
  const t1 = '01-2026-03-01-99-000-5'
  const t2 = '02-2026-03-08-99-000-5'
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['', '', '汇总', t1, '', t2, ''],
      ['学号', '姓名', '课堂总分(满分40.0分)', '签到次数（开课2次）', '到课率', '弹幕总次数', '投稿总次数'],
      ['80250001', '甲', '0', '2', '100%', '3', '1'],
      ['80250002', '乙', '0', '1', '50%', '0', '0'],
      // 重复学号:两行拆开(1+1 次签到、弹幕 2+1),解析须合并
      ['80250003', '丙', '0', '1', '50%', '2', '0'],
      ['80250003', '丙', '0', '1', '50%', '1', '2'],
    ]),
    '数据汇总',
  )
  const session = (label: string, rows: string[][], qHeader: string[] = []) =>
    XLSX.utils.aoa_to_sheet([
      [label],
      ['', '', '', '签到信息', '', '', '课堂互动信息', '', '', '', '', '', '题目信息'],
      ['学号', '院校', '姓名', '签到方式', '签到时间', '备注标签', '投稿次数', '抢答成功次数', '抢答加分', '弹幕次数', '课程表现加分', '累计得分', ...qHeader],
      ['', '', '', '', '', '', '', '', '', '', '', '', ...qHeader.map(() => '最终得分')],
      ...rows,
    ])
  // 01 节:有 2 道题(「未批改」「0」「字母」都算答过,「未答题」不算);弹幕/投稿都开。
  XLSX.utils.book_append_sheet(
    wb,
    session(
      `${t1}-课堂情况-20`,
      [
        ['80250001', '校', '甲', '扫二维码', '10:00', '', '1', '0', '0', '2', '', '0', 'B', '未批改'],
        ['80250002', '校', '乙', '未上课', '', '', '0', '0', '0', '0', '', '0', '未答题', '未答题'],
        ['80250003', '校', '丙', '扫二维码', '10:01', '', '0', '0', '0', '2', '', '0', '未答题', '0'],
      ],
      ['第1题 投票题', '第2题 主观题 10.0分'],
    ),
    's01',
  )
  // 02 节:无题;弹幕全 0(当天没开)→ danmakuOpen=false;丙缺行(该节未到)。
  XLSX.utils.book_append_sheet(
    wb,
    session(`${t2}-课堂情况-20`, [
      ['80250001', '校', '甲', '“正在上课”提示', '09:59', '', '0', '0', '0', '0', '', '0'],
      ['80250002', '校', '乙', '扫二维码', '10:00', '', '0', '0', '0', '0', '', '0'],
    ]),
    's02',
  )
  // 重开课(带全角（2)后缀,不在汇总组表头里)→ counted=false,任何信号不进分母。
  XLSX.utils.book_append_sheet(
    wb,
    session(`02-2026-03-08-99-000-5（2）-课堂情况-20`, [
      ['80250001', '校', '甲', '扫二维码', '14:00', '', '5', '0', '0', '9', '', '0'],
    ]),
    's02r',
  )
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

describe('parseRainClassroom', () => {
  const parsed = parseRainClassroom(buildWorkbook())

  it('识别计次节:汇总组表头标题集合为准,重开课(（N）后缀)不计次', () => {
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.declaredSessions).toBe(2)
    expect(parsed.sessions.map((s) => s.counted)).toEqual([true, true, false])
    expect(parsed.sessions[0].date).toBe('2026-03-01')
  })

  it('信号开放旗标按当天实际使用判定(02 节弹幕全 0 ⇒ 未开)', () => {
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.sessions[0]).toMatchObject({ danmakuOpen: true, postOpen: true, questions: 2 })
    expect(parsed.sessions[1]).toMatchObject({ danmakuOpen: false, postOpen: false, questions: 0 })
  })

  it('答题=trim 非空且≠未答题:「未批改」「0 分」「字母」都算答过', () => {
    if (!parsed.ok) throw new Error(parsed.error)
    const by = new Map(parsed.students.map((s) => [s.studentNo, s]))
    expect(by.get('80250001')!.detail[0].answered).toBe(true) // B + 未批改
    expect(by.get('80250002')!.detail[0].answered).toBe(false) // 全未答题
    expect(by.get('80250003')!.detail[0].answered).toBe(true) // 「0」= 答了得0分
  })

  it('重复学号合并:汇总求和、逐节 到课OR/计数SUM;明细缺行=该节未到零参与', () => {
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.students).toHaveLength(3) // 4 行 → 3 唯一
    const c = parsed.students.find((s) => s.studentNo === '80250003')!
    expect(c.duplicated).toBe(true)
    expect(c.summaryAttended).toBe(2) // 1+1
    expect(c.summaryDanmaku).toBe(3) // 2+1
    expect(c.detail[1]).toMatchObject({ attended: false, danmaku: 0 }) // 02 节缺行
  })

  it('对账警示:剔除重开课后与汇总核对;丙投稿(汇总2,明细0)不一致 ⇒ 聚合警示', () => {
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.warnings.some((w) => w.startsWith('rain.warnPostsMismatch:'))).toBe(true)
    // 签到全对(甲 2/乙 1/丙 1+1=2? 丙实际计次节只到 01 ⇒ 派生 1 ≠ 汇总 2)→ 也应有签到警示
    expect(parsed.warnings.some((w) => w.startsWith('rain.warnAttendanceMismatch:'))).toBe(true)
  })

  it('坏输入:非 xlsx / 缺表返回 i18n key 而非抛异常', () => {
    const r = parseRainClassroom(new Uint8Array([1, 2, 3]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.startsWith('rain.err')).toBe(true)
  })
})
