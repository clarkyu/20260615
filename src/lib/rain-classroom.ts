// 雨课堂「课堂情况」xlsx 解析(纯 infra,无 prisma/auth)。产出逐生逐节四信号原始数据,
// 分数由 lib/domain/class-perf.ts 读时计算。解析口径(对抗复核定稿,实测于 2531320 班样本):
//
// - Sheet1 = 每生汇总:第 1 行是「计次节标题」组表头(与「开课N次」一致的权威集合),
//   第 2 行是列头(学号/姓名/签到次数（开课N次）/弹幕总次数/投稿总次数…),第 3 行起是数据。
// - 其余 sheet = 每节明细:A1 为节标题。**计次判定**:A1 以 Sheet1 组表头集合中某标题开头
//   ⇒ 计次;A1 含全角/半角「(N)」重开后缀 ⇒ 不计次;两者皆无 ⇒ 默认计次并出警示。
//   (留一法只作诊断,不做主判定——重开课被平台从汇总里整体剔除,签到/投稿都按此对账。)
// - 题目列:表头前缀 /第\d+题/ 按**列索引**收集(同表「第1题」会重复出现,按文本建 map 会丢列);
//   「答过」= 单元格 trim 非空且 ≠「未答题」——「未批改」「字母选项」「0 分」都算答过
//   (按参与计,不评对错;老师日后补批不会翻转参与位)。
// - 重复学号(同一学生两条注册记录):逐节合并 —— 到课 OR、弹幕/投稿 SUM、答题 OR;汇总行求和。
// - 签到:值 ∉ {空, 未上课} ⇒ 到课;未知枚举值收进 warnings 供人工确认。
// - 明细表整行缺失的学生 = 该节未到、零参与(按花名册补零,不报错)。

import * as XLSX from 'xlsx'

export interface RainSession {
  label: string
  date: string | null // 从标题提取 YYYY-MM-DD
  counted: boolean // 计次节(进所有信号分母);重开课=false(仅展示)
  danmakuOpen: boolean // 该节全班弹幕>0 ⇒ 当天开放
  postOpen: boolean
  questions: number // 题目列数;>0 = 当天有随堂题
}

export interface RainStudentDetail {
  attended: boolean
  danmaku: number
  posts: number
  answered: boolean
}

export interface RainStudent {
  studentNo: string
  name: string
  duplicated: boolean // 汇总里出现多行(已合并)
  summaryAttended: number // 汇总「签到次数」列(权威口径,分子)
  summaryDanmaku: number
  summaryPosts: number
  detail: RainStudentDetail[] // 与 sessions 按下标对齐(含不计次节,消费方按 counted 过滤)
}

export type RainParse =
  | {
      ok: true
      sessions: RainSession[]
      students: RainStudent[]
      declaredSessions: number | null // 「开课N次」的 N
      warnings: string[] // 聚合级警示(不含学生个体信息),导入预览展示
    }
  | { ok: false; error: string } // i18n key

const STUDENT_NO = /^\d{6,}$/
const toInt = (x: unknown): number => {
  const n = Number(String(x ?? '').trim())
  return Number.isFinite(n) ? Math.trunc(n) : 0
}
const norm = (s: unknown): string => String(s ?? '').trim()

export function parseRainClassroom(buffer: ArrayBuffer | Uint8Array): RainParse {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), { type: 'array' })
  } catch {
    return { ok: false, error: 'rain.errRead' }
  }
  if (wb.SheetNames.length < 2) return { ok: false, error: 'rain.errSheets' }
  const warnings: string[] = []

  // ── Sheet1 汇总 ──
  const summary = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  })
  if (summary.length < 3) return { ok: false, error: 'rain.errSummary' }
  const groupRow = summary[0].map(norm)
  const headerRow = summary[1].map(norm)
  // 计次节标题集合(组表头里非空、非「汇总」的格子)。
  const countedTitles = groupRow.filter((c) => c && c !== '汇总')
  const col = (needle: string) => headerRow.findIndex((h) => h.includes(needle))
  const cNo = col('学号')
  const cName = col('姓名')
  const cAtt = col('签到次数')
  const cDan = col('弹幕总次数')
  const cPost = col('投稿总次数')
  if (cNo < 0 || cName < 0 || cAtt < 0) return { ok: false, error: 'rain.errColumns' }
  const declaredSessions = (() => {
    const m = headerRow[cAtt].match(/开课(\d+)次/)
    return m ? Number(m[1]) : null
  })()

  interface Agg {
    name: string
    rows: number
    att: number
    dan: number
    post: number
    detail: Map<number, RainStudentDetail> // sessionIndex → 信号
  }
  const byNo = new Map<string, Agg>()
  const order: string[] = []
  for (let r = 2; r < summary.length; r++) {
    const no = norm(summary[r][cNo])
    if (!STUDENT_NO.test(no)) continue
    let a = byNo.get(no)
    if (!a) {
      a = { name: norm(summary[r][cName]), rows: 0, att: 0, dan: 0, post: 0, detail: new Map() }
      byNo.set(no, a)
      order.push(no)
    }
    a.rows++
    a.att += toInt(summary[r][cAtt])
    if (cDan >= 0) a.dan += toInt(summary[r][cDan])
    if (cPost >= 0) a.post += toInt(summary[r][cPost])
  }
  if (order.length === 0) return { ok: false, error: 'rain.errNoStudents' }

  // ── 每节明细 sheet ──
  const sessions: RainSession[] = []
  const unknownSignin = new Set<string>()
  for (let s = 1; s < wb.SheetNames.length; s++) {
    const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[s]], {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    })
    if (grid.length === 0) continue
    const label = norm(grid[0]?.[0]) || wb.SheetNames[s]
    // 重开课后缀「（N）」优先判定:重开课常与原节共享标题前缀,若先做前缀匹配会被误判计次。
    const remake = /[（(]\d+[)）]/.test(label)
    const inSummary = countedTitles.some((t) => label.startsWith(t))
    // 重开课 ⇒ 不计次;命中汇总标题 ⇒ 计次;两者皆无 ⇒ 默认计次并警示(容忍标题微差,
    // 宁可让老师在预览里人工确认,不静默丢一节)。
    const counted = remake ? false : true
    if (!remake && !inSummary) warnings.push(`rain.warnUnmatchedSession:${label}`)
    const idx = sessions.length
    // 列头 = 前 4 行逐列拼接(类别行/列头行/子头行错落,拼起来找关键字最稳)。
    const headScan = (c: number) => [0, 1, 2, 3].map((r) => norm(grid[r]?.[c])).join('/')
    const width = Math.max(...grid.slice(0, 5).map((row) => row.length), 0)
    let cSi = -1
    let cDanmu = -1
    let cPosts = -1
    const qcols: number[] = []
    for (let c = 0; c < width; c++) {
      const h = headScan(c)
      if (cSi < 0 && h.includes('签到方式')) cSi = c
      if (cDanmu < 0 && h.includes('弹幕次数')) cDanmu = c
      if (cPosts < 0 && h.includes('投稿次数')) cPosts = c
      if (/第\d+题/.test(h)) qcols.push(c)
    }
    let danOpen = false
    let postOpen = false
    for (let r = 1; r < grid.length; r++) {
      const no = norm(grid[r][0])
      if (!STUDENT_NO.test(no)) continue
      const agg = byNo.get(no)
      const si = cSi >= 0 ? norm(grid[r][cSi]) : ''
      if (si && si !== '未上课' && si !== '扫二维码' && !si.includes('正在上课')) unknownSignin.add(si)
      const attended = si !== '' && si !== '未上课'
      const dan = cDanmu >= 0 ? toInt(grid[r][cDanmu]) : 0
      const post = cPosts >= 0 ? toInt(grid[r][cPosts]) : 0
      const answered = qcols.some((qc) => {
        const v = norm(grid[r][qc])
        return v !== '' && v !== '未答题'
      })
      if (dan > 0) danOpen = true
      if (post > 0) postOpen = true
      if (!agg) continue // 明细有、汇总无的学号:不建行,记聚合警示(循环后)
      const prev = agg.detail.get(idx)
      agg.detail.set(idx, {
        attended: (prev?.attended ?? false) || attended, // 重复学号:到课 OR
        danmaku: (prev?.danmaku ?? 0) + dan, // 计数 SUM
        posts: (prev?.posts ?? 0) + post,
        answered: (prev?.answered ?? false) || answered,
      })
    }
    sessions.push({
      label,
      date: label.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
      counted,
      danmakuOpen: danOpen,
      postOpen,
      questions: qcols.length,
    })
  }
  if (unknownSignin.size > 0) warnings.push(`rain.warnSigninValues:${[...unknownSignin].sort().join(',')}`)

  // ── 组装 + 对账 ──
  const students: RainStudent[] = order.map((no) => {
    const a = byNo.get(no)!
    return {
      studentNo: no,
      name: a.name,
      duplicated: a.rows > 1,
      summaryAttended: a.att,
      summaryDanmaku: a.dan,
      summaryPosts: a.post,
      // 缺行 = 该节未到、零参与(按下标补齐)。
      detail: sessions.map((_, i) => a.detail.get(i) ?? { attended: false, danmaku: 0, posts: 0, answered: false }),
    }
  })
  // 交叉对账(剔除不计次节后应与汇总一致——平台口径如此):不一致人数走聚合警示。
  const countedIdx = sessions.map((s, i) => (s.counted ? i : -1)).filter((i) => i >= 0)
  let attMismatch = 0
  let postMismatch = 0
  for (const st of students) {
    const att = countedIdx.reduce((n, i) => n + (st.detail[i].attended ? 1 : 0), 0)
    const post = countedIdx.reduce((n, i) => n + st.detail[i].posts, 0)
    if (att !== st.summaryAttended) attMismatch++
    if (post !== st.summaryPosts) postMismatch++
  }
  if (attMismatch > 0) warnings.push(`rain.warnAttendanceMismatch:${attMismatch}`)
  if (postMismatch > 0) warnings.push(`rain.warnPostsMismatch:${postMismatch}`)
  if (declaredSessions != null && countedIdx.length !== declaredSessions) {
    warnings.push(`rain.warnSessionCount:${countedIdx.length}/${declaredSessions}`)
  }

  return { ok: true, sessions, students, declaredSessions, warnings }
}
