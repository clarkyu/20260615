import type { ItemType } from '@/lib/schema/paper'

// 规则切分(SPEC §8 导入向导第二步、附录 B):Markdown → 大题 / 题组 / 小题草稿。纯函数。
// 规则拿不准的地方不猜:打 flag(校对页标红)交给 AI 结构化与教师确认。
// 处理的陷阱(附录 B):大题序号与标点混用;小题编号丢失 / 被转成列表项(按序推断并标 numberInferred);
// 空位写法不统一(多空格数字、下划线、无编号空格、N.____);提示词在空位后或句末;Passage 标题夹粗体碎片;
// 一行两个空位;词块带标点且以 / 分隔;作文要求为中文条目、字数写在正文里。

export interface RuleFlag {
  code: string
  message: string
}
export interface RuleItem {
  number: number
  numberInferred: boolean
  type: ItemType
  raw: string
  content: Record<string, unknown>
  contextSnippet?: string
  flags: RuleFlag[]
}
export interface RuleGroup {
  order: number
  kind: 'cloze' | 'reading_fill' | 'reading_qa' | 'standalone'
  stimulus?: { kind: 'passage' | 'letter' | 'notes' | 'dialogue'; title?: string; body: string }
  frame?: string
  items: RuleItem[]
  flags: RuleFlag[]
}
export interface RuleSection {
  order: number
  code: string
  title: string
  instructions: string
  itemType: ItemType | null
  scorePerItem: number | null
  count: number | null
  totalScore: number | null
  /** 标题整行(含括号里的分值说明) */
  heading: string
  groups: RuleGroup[]
  flags: RuleFlag[]
  raw: string
}
export interface RuleDraft {
  title: string | null
  sections: RuleSection[]
  /** 试卷末尾的参考答案原文(若有);交给 AI 结构化与教师核对 */
  answerKey: string | null
  flags: RuleFlag[]
}

const SP = '[\\u00A0 \\t]'
const CJK = /[一-鿿]/
const CN_NUM = '一二三四五六七八九十'
const HEADING = new RegExp(`^\\s*(?:#+\\s*)?\\**\\s*([${CN_NUM}]+)\\s*[．.、,，]\\s*(.*?)\\**\\s*$`)
const PASSAGE = /^\s*\**\s*Passage\s*\**\s*(\d+)\s*\**\s*[.．:：]?\s*(.*?)\**\s*$/i
const ORDERED_LIST = /^(\d+)\.\s{2,}(.+)$/ // turndown 有序列表:编号已丢失
const BULLET = /^[-*•l]\s+(.+)$/
const NUMBERED = /^(\d{1,3})\s*[.．、:：]?\s*(.*)$/

function flag(code: string, message: string): RuleFlag {
  return { code, message }
}

/** 去掉 turndown 的转义(\. \_ \* 等)。 */
export function unescapeMd(s: string): string {
  return s.replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, '$1')
}
const stripBold = (s: string) => s.replace(/\*\*/g, '').replace(/^\s*#+\s*/, '').trim()
const norm = (s: string) => s.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim()

function cnNum(s: string): number {
  const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  if (s === '十') return 10
  if (s.length === 1) return map[s] ?? 0
  if (s.startsWith('十')) return 10 + (map[s[1]!] ?? 0)
  if (s.endsWith('十')) return (map[s[0]!] ?? 0) * 10
  return (map[s[0]!] ?? 0) * 10 + (map[s[2]!] ?? 0)
}

/** 大题标题里的分值信息:每题 N 分 / 每小题 N 分 / 每空 N 分;共 N 小题 / 共 N 题 / 共 N 空;满分 N 分 / 共 N 分。 */
export function parseHeadingMeta(text: string): { scorePerItem: number | null; count: number | null; totalScore: number | null } {
  const t = norm(text).replace(/[（）]/g, (c) => (c === '（' ? '(' : ')'))
  const per = /每\s*(?:小)?(?:题|空)\s*(\d+(?:\.\d+)?)\s*分/.exec(t)
  const cnt = /共\s*(\d+)\s*(?:小)?(?:题|空)/.exec(t)
  const tot = /(?:满分|共)\s*(\d+(?:\.\d+)?)\s*分/.exec(t) ?? (per ? null : /(?:^|[^每])(\d+(?:\.\d+)?)\s*分/.exec(t))
  return { scorePerItem: per ? Number(per[1]) : null, count: cnt ? Number(cnt[1]) : null, totalScore: tot ? Number(tot[1]) : null }
}

export function inferSectionType(title: string): { itemType: ItemType | null; kind: RuleGroup['kind'] } {
  const t = title
  if (/短文填空|完形|语法填空/.test(t)) return { itemType: 'fill', kind: 'cloze' }
  if (/连词成句|排序|组句/.test(t)) return { itemType: 'reorder', kind: 'standalone' }
  if (/阅读填词|摘要填空|填词/.test(t)) return { itemType: 'fill', kind: 'reading_fill' }
  if (/阅读问答|阅读理解|回答问题/.test(t)) return { itemType: 'short_answer', kind: 'reading_qa' }
  if (/汉译英|翻译/.test(t)) return { itemType: 'translate_c2e_fill', kind: 'standalone' }
  if (/作文|写作|书面表达/.test(t)) return { itemType: 'writing', kind: 'standalone' }
  if (/选择/.test(t)) return { itemType: 'single_choice', kind: 'standalone' }
  return { itemType: null, kind: 'standalone' }
}

/** 空位识别:返回替换成 {{n}} 的文本与空位列表(带提示词)。expectedStart 用于无编号空位。 */
export function extractBlanks(text: string, expectedStart: number, opts: { numbered: boolean } = { numbered: true }): { text: string; blanks: Array<{ number: number; hint?: string; inferred: boolean }>; flags: RuleFlag[] } {
  const blanks: Array<{ number: number; hint?: string; inferred: boolean }> = []
  const flags: RuleFlag[] = []
  let next = expectedStart
  let out = text
  const take = (n: number | null, hint: string | undefined, inferred: boolean) => {
    const number = n ?? next
    blanks.push({ number, hint: hint?.trim() || undefined, inferred })
    next = number + 1
    return `{{${number}}}`
  }
  // A:多空格夹数字(可带提示词)   1   (big)
  out = out.replace(new RegExp(`${SP}{2,}(\\d{1,3})${SP}{2,}(?:\\(([^)]{1,40})\\)${SP}?)?`, 'g'), (_m, n: string, hint?: string) => ` ${take(Number(n), hint, false)} `)
  // B:数字 + 点 + 下划线   1.______ (proud)
  out = out.replace(new RegExp(`(\\d{1,3})\\s*[.．]\\s*_{2,}${SP}*(?:\\(([^)]{1,40})\\))?`, 'g'), (_m, n: string, hint?: string) => take(Number(n), hint, false))
  // C:下划线夹数字   ___1___ / __(1)__
  out = out.replace(/_{2,}\s*\(?(\d{1,3})\)?\s*_{2,}/g, (_m, n: string) => take(Number(n), undefined, false))
  // D:已是占位符 {{n}}
  out = out.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => {
    if (!blanks.some((b) => b.number === Number(n))) take(Number(n), undefined, false)
    return `{{${n}}}`
  })
  // E:无编号空位:一串下划线 / 一串不间断空格(≥2)
  out = out.replace(new RegExp(`_{3,}|\\u00A0{2,}`, 'g'), () => ` ${take(null, undefined, true)} `)
  if (opts.numbered && blanks.length === 0) {
    // F:折叠后的单空格数字(兜底,按序号推断,标红)
    out = out.replace(/(^|\s)(\d{1,3})(\s+\(([^)]{1,40})\))?(?=\s|$)/g, (m, pre: string, n: string, _h: string | undefined, hint?: string) => {
      if (Number(n) !== next) return m
      flags.push(flag('blank_inferred', `第 ${n} 空按序号推断（原文空位被折叠）`))
      return `${pre}${take(Number(n), hint, true)}`
    })
  }
  const cleaned = out
    .replace(/ /g, ' ')
    .replace(/\}\}(?=[A-Za-z0-9])/g, '}} ')
    .replace(/(?<=[A-Za-z0-9,])\{\{/g, ' {{')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([.,;:!?])/g, '$1')
  return { text: cleaned, blanks, flags }
}

/** 含 {{n}} 的句子(短文填空的 contextSnippet)。 */
export function sentenceAround(frame: string, n: number): string | undefined {
  const idx = frame.indexOf(`{{${n}}}`)
  if (idx < 0) return undefined
  const before = frame.slice(0, idx)
  const after = frame.slice(idx)
  // 句子起点:上一个「句末标点 + 空格」之后,或上一个换行之后(两者分隔符长度不同)
  const punct = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '))
  const nl = before.lastIndexOf('\n')
  const start = punct > nl ? punct + 2 : nl >= 0 ? nl + 1 : 0
  const endRel = after.search(/[.!?](\s|$)/)
  const end = endRel < 0 ? frame.length : idx + endRel + 1
  return frame.slice(start, end).trim()
}

interface Line {
  text: string
  raw: string
}
function itemLine(line: string, expected: number): { number: number; inferred: boolean; body: string } | null {
  const ol = ORDERED_LIST.exec(line)
  if (ol) return { number: expected, inferred: true, body: ol[2]!.trim() }
  const bl = BULLET.exec(line)
  if (bl && !/^[A-Za-z]/.test(line)) return { number: expected, inferred: true, body: bl[1]!.trim() }
  const nm = NUMBERED.exec(line)
  if (nm && nm[2]) {
    const n = Number(nm[1])
    // 编号必须接近期望值(允许跳号 ≤ 3),否则视为正文里的数字
    if (n >= expected && n <= expected + 3) return { number: n, inferred: false, body: nm[2].trim() }
  }
  return null
}

function splitPassages(lines: Line[]): Array<{ title?: string; lines: Line[] }> {
  const out: Array<{ title?: string; lines: Line[] }> = []
  let cur: { title?: string; lines: Line[] } | null = null
  for (const l of lines) {
    const p = PASSAGE.exec(l.text)
    if (p) {
      cur = { title: `Passage ${p[1]}${p[2] ? ` ${stripBold(p[2])}` : ''}`, lines: [] }
      out.push(cur)
      continue
    }
    if (!cur) {
      cur = { lines: [] }
      out.push(cur)
    }
    cur.lines.push(l)
  }
  return out
}

function parseCloze(sec: RuleSection, lines: Line[], start: number): void {
  const paras = lines.filter((l) => !CJK.test(l.text) || /\{\{|_{2,}/.test(l.text))
  const title = paras.length && /^\*\*.*\*\*$/.test(paras[0]!.text.trim()) && paras[0]!.text.length < 80 ? stripBold(paras.shift()!.text) : undefined
  const joined = paras.map((l) => stripBold(l.text)).join('\n\n')
  const { text, blanks, flags } = extractBlanks(joined, start)
  const g: RuleGroup = { order: 1, kind: 'cloze', frame: text, items: [], flags: [...flags] }
  if (title) g.stimulus = undefined
  for (const b of blanks) {
    g.items.push({
      number: b.number,
      numberInferred: b.inferred,
      type: 'fill',
      raw: sentenceAround(text, b.number) ?? '',
      content: { blank: b.number, ...(b.hint ? { hint: b.hint } : {}), maxWords: 1 },
      contextSnippet: sentenceAround(text, b.number),
      flags: b.inferred ? [flag('blank_inferred', `第 ${b.number} 空编号按顺序推断`)] : [],
    })
  }
  if (g.items.length === 0) g.flags.push(flag('no_blanks', '没有识别出任何空位'))
  sec.groups.push(g)
}

function parseReorder(sec: RuleSection, lines: Line[], start: number): void {
  const g: RuleGroup = { order: 1, kind: 'standalone', items: [], flags: [] }
  let expected = start
  for (const l of lines) {
    const it = itemLine(l.text, expected)
    if (!it) continue
    const chunks = it.body
      .split(/\s*\/\s*/)
      .map((c) => c.trim())
      .filter(Boolean)
    const flags: RuleFlag[] = []
    if (it.inferred) flags.push(flag('number_inferred', '题号缺失，按顺序推断'))
    if (chunks.length < 2) flags.push(flag('chunks_unclear', '词块少于 2 个，请检查分隔'))
    g.items.push({ number: it.number, numberInferred: it.inferred, type: 'reorder', raw: l.text, content: { chunks }, flags })
    expected = it.number + 1
  }
  sec.groups.push(g)
}

function parseReadingFill(sec: RuleSection, lines: Line[], start: number): void {
  let expected = start
  let order = 1
  for (const p of splitPassages(lines)) {
    const body: Line[] = []
    const frameLines: string[] = []
    const items: RuleItem[] = []
    const gflags: RuleFlag[] = []
    let inItems = false
    for (const l of p.lines) {
      const it = itemLine(l.text, expected)
      const hasBlank = / {2,}|_{2,}|\{\{\d+\}\}/.test(l.text)
      if (!inItems && !it && !(hasBlank && !CJK.test(l.text))) {
        body.push(l)
        continue
      }
      inItems = true
      if (!it && !hasBlank) {
        // 摘要标题之类(如 **How to Deal with Disagreements**)
        frameLines.push(stripBold(l.text))
        continue
      }
      const text = it ? it.body : l.text
      const { text: framed, blanks } = extractBlanks(text, it && !it.inferred ? it.number : expected, { numbered: false })
      if (blanks.length === 0) {
        // 空位被折叠得无影无踪:放到句末并标红
        const n = it ? it.number : expected
        frameLines.push(`${framed.replace(/\.?\s*$/, '')} {{${n}}}.`)
        items.push({ number: n, numberInferred: !it || it.inferred, type: 'fill', raw: l.text, content: { blank: n, maxWords: 1 }, flags: [flag('blank_missing', `第 ${n} 空在原文中无法定位（空格被折叠），已放在句末，请校对位置`)] })
        expected = n + 1
        continue
      }
      frameLines.push(framed)
      blanks.forEach((b, bi) => {
        const flags: RuleFlag[] = []
        // 行首有明确题号 → 第一个空位的题号可信;同一行后续空位、或整行无题号才算推断
        const inferred = it ? it.inferred || (bi > 0 && b.inferred) : b.inferred
        if (it?.inferred) flags.push(flag('number_inferred', '题号缺失，按顺序推断'))
        else if (inferred) flags.push(flag('number_inferred', '一行多个空位，后续编号按顺序推断'))
        items.push({ number: b.number, numberInferred: inferred, type: 'fill', raw: l.text, content: { blank: b.number, maxWords: 1 }, flags })
        expected = b.number + 1
      })
    }
    if (items.length === 0) continue
    const bodyText = body.map((l) => stripBold(l.text)).join('\n\n').trim()
    let title = p.title
    const first = body[0]?.text.trim()
    if (first && /^\*\*.*\*\*$/.test(first) && first.length < 60) {
      title = `${title ?? ''} ${stripBold(first)}`.trim()
    }
    const bodyClean = first && /^\*\*.*\*\*$/.test(first) && first.length < 60 ? body.slice(1).map((l) => stripBold(l.text)).join('\n\n').trim() : bodyText
    if (!bodyClean) gflags.push(flag('no_stimulus', '没有识别出阅读材料'))
    sec.groups.push({ order: order++, kind: 'reading_fill', stimulus: { kind: 'passage', title, body: bodyClean }, frame: frameLines.join('\n\n'), items, flags: gflags })
  }
}

function parseReadingQa(sec: RuleSection, lines: Line[], start: number): void {
  let expected = start
  let order = 1
  for (const p of splitPassages(lines)) {
    const body: Line[] = []
    const items: RuleItem[] = []
    let inItems = false
    for (const l of p.lines) {
      const it = itemLine(l.text, expected)
      if (!it) {
        if (!inItems) body.push(l)
        continue
      }
      inItems = true
      const tr = /^Translate\s*(?:the\s+underlined\s+sentences?(?:\s+into\s+Chinese)?)?\s*[:：]?\s*[“"'‘]?\s*(.+?)\s*[”"'’]?\s*$/i.exec(it.body)
      const flags: RuleFlag[] = []
      if (it.inferred) flags.push(flag('number_inferred', '题号缺失，按顺序推断'))
      if (tr) {
        const source = tr[1]!.trim()
        if (!/[A-Za-z]/.test(source)) flags.push(flag('source_missing', '翻译题没有识别出要翻译的句子（画线句可能只在原文里），请从材料中复制到「英文原句」'))
        items.push({ number: it.number, numberInferred: it.inferred, type: 'translate_e2c', raw: l.text, content: { source: /[A-Za-z]/.test(source) ? source : '' }, flags })
      }
      else items.push({ number: it.number, numberInferred: it.inferred, type: 'short_answer', raw: l.text, content: { question: it.body }, flags })
      expected = it.number + 1
    }
    if (items.length === 0) continue
    const bodyText = body.map((l) => stripBold(l.text)).join('\n\n').trim()
    const kind: NonNullable<RuleGroup['stimulus']>['kind'] = /^Dear\b/i.test(bodyText) ? 'letter' : 'passage'
    sec.groups.push({ order: order++, kind: 'reading_qa', stimulus: { kind, title: p.title, body: bodyText }, items, flags: bodyText ? [] : [flag('no_stimulus', '没有识别出阅读材料')] })
  }
}

function parseC2E(sec: RuleSection, lines: Line[], start: number): void {
  const g: RuleGroup = { order: 1, kind: 'standalone', items: [], flags: [] }
  const maxWordsM = /不超过?\s*([一两二三四五]|\d+)\s*个?\s*(?:英文)?(?:单)?词/.exec(sec.instructions + sec.heading)
  const cnMap: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5 }
  const maxWords = maxWordsM ? (cnMap[maxWordsM[1]!] ?? Number(maxWordsM[1])) : 2
  let expected = start
  let pending: { number: number; inferred: boolean; zh: string; raw: string } | null = null
  const finish = (en: string | null) => {
    if (!pending) return
    const flags: RuleFlag[] = []
    if (pending.inferred) flags.push(flag('number_inferred', '题号缺失，按顺序推断'))
    let frame = en ?? ''
    let hint: string | undefined
    // 提示词:空位后的括号 或 句末括号
    const tail = /\(([^)]{1,30})\)\s*([.。])?\s*$/.exec(frame)
    if (tail) {
      hint = tail[1]!.trim()
      const before = frame.slice(0, tail.index).trim()
      // 句末括号:句子本身的句号在括号前或括号后都保留一个
      frame = /[.!?]$/.test(before) ? before : `${before}${tail[2] ? '.' : ''}`
    }
    const after = /_{2,}\s*\(([^)]{1,30})\)/.exec(frame)
    if (after) {
      hint = after[1]!.trim()
      frame = frame.replace(after[0], '______')
    }
    if (!hint) {
      const any = /\(([A-Za-z][^)]{0,29})\)/.exec(frame)
      if (any) {
        hint = any[1]!.trim()
        frame = frame.replace(any[0], '').replace(/\s{2,}/g, ' ').trim()
      }
    }
    const blanks = frame.match(/_{2,}/g)?.length ?? 0
    frame = frame.replace(/_{2,}/, '{{blank}}').replace(/_{2,}/g, '')
    if (!en) flags.push(flag('frame_missing', '缺少英文句子'))
    else if (blanks !== 1) flags.push(flag('blank_unclear', `英文句子里识别到 ${blanks} 个空位（应为 1 个）`))
    if (!hint) flags.push(flag('hint_missing', '没有识别出提示词'))
    frame = frame.replace(/\s+([.,!?])/g, '$1').replace(/\s{2,}/g, ' ').trim()
    g.items.push({ number: pending.number, numberInferred: pending.inferred, type: 'translate_c2e_fill', raw: `${pending.raw}\n${en ?? ''}`, content: { zh: pending.zh, frame, ...(hint ? { hint } : {}), maxWords }, flags })
    expected = pending.number + 1
    pending = null
  }
  for (const l of lines) {
    const it = itemLine(l.text, expected)
    if (it && CJK.test(it.body)) {
      finish(null)
      // 同一行既有中文又有英文:在第一个英文句子处切开
      const m = /^(.*?[。！？!?.])\s*([A-Za-z].*)$/.exec(it.body)
      if (m && /_{2,}/.test(m[2]!)) {
        pending = { number: it.number, inferred: it.inferred, zh: m[1]!.trim(), raw: l.text }
        finish(m[2]!.trim())
      } else pending = { number: it.number, inferred: it.inferred, zh: it.body.trim(), raw: l.text }
      continue
    }
    if (pending && !CJK.test(l.text) && /[A-Za-z]/.test(l.text)) {
      finish(unescapeMd(l.text).trim())
    }
  }
  finish(null)
  sec.groups.push(g)
}

function parseWriting(sec: RuleSection, lines: Line[], start: number): void {
  const reqs: string[] = []
  const prompt: string[] = []
  for (const l of lines) {
    const own = /^(\d{1,3})\s*[.．、:：]\s*(.+)$/.exec(l.text)
    if (own && Number(own[1]) === start) {
      prompt.push(stripBold(own[2]!))
      continue
    }
    const m = /^[(（]?(\d{1,2})[)）.．、:：]\s*(.+)$/.exec(l.text)
    if (m && Number(m[1]) <= 9 && CJK.test(m[2]!)) reqs.push(m[2]!.replace(/[。；;]\s*$/, '').trim())
    else prompt.push(stripBold(l.text))
  }
  const all = `${sec.heading}\n${lines.map((l) => l.text).join('\n')}`
  const minM = /不少于\s*(\d+)\s*个?\s*词/.exec(all)
  const maxM = /不超过\s*(\d+)\s*个?\s*词/.exec(all)
  const genre = /邮件|e-?mail/i.test(all) ? 'email' : /封信|写信|书信/.test(all) ? 'letter' : /通知/.test(all) ? 'notice' : /日记/.test(all) ? 'diary' : 'essay'
  const persona = /以(.{1,8}?)的名义/.exec(all)?.[1] ?? /假[定设]你是(.{1,8}?)[,，。]/.exec(all)?.[1]
  const flags: RuleFlag[] = []
  if (!minM) flags.push(flag('min_words_missing', '没有识别出最少词数'))
  if (reqs.length === 0) flags.push(flag('requirements_missing', '没有识别出作文要求条目'))
  sec.groups.push({
    order: 1,
    kind: 'standalone',
    flags: [],
    items: [
      {
        number: start,
        numberInferred: true,
        type: 'writing',
        raw: all,
        content: { genre, ...(persona ? { persona: persona.trim() } : {}), prompt: prompt.join('\n').trim(), requirements: reqs, minWords: minM ? Number(minM[1]) : 40, ...(maxM ? { maxWords: Number(maxM[1]) } : {}) },
        flags,
      },
    ],
  })
}

/** 题型识别不出的大题:仍按编号行切成小题占位(暂作简答),每题标红等教师改题型;不让向导在这一步死掉。 */
function parseUnknown(sec: RuleSection, lines: Line[], start: number): void {
  const g: RuleGroup = { order: 1, kind: 'standalone', items: [], flags: [flag('type_unknown', '题型未知：已按编号行切成小题占位，请在上方选择题型并逐题核对')] }
  let expected = start
  for (const l of lines) {
    const it = itemLine(l.text, expected)
    if (!it) continue
    g.items.push({ number: it.number, numberInferred: it.inferred, type: 'short_answer', raw: l.text, content: { question: it.body }, flags: [flag('type_unknown', '题型未知，请选择题型后核对内容')] })
    expected = it.number + 1
  }
  sec.groups.push(g)
}

export function parseMarkdown(markdown: string): RuleDraft {
  const rawLines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const lines: Line[] = rawLines.map((raw) => ({ raw, text: unescapeMd(raw).trimEnd() })).filter((l) => l.text.trim() !== '')
  const draft: RuleDraft = { title: null, sections: [], answerKey: null, flags: [] }
  let cur: { sec: RuleSection; lines: Line[] } | null = null
  const flush = () => {
    if (cur) cur.sec.raw = cur.lines.map((l) => l.raw).join('\n')
  }
  const chunks: Array<{ sec: RuleSection; lines: Line[] }> = []
  const answerKeyLines: string[] = []
  let inAnswerKey = false
  for (const l of lines) {
    if (inAnswerKey) {
      answerKeyLines.push(l.text)
      continue
    }
    const h = HEADING.exec(l.text)
    const isKeyHeading = /^(参考答案|答案(与|及)解析|答案)\s*[:：]?$/.test(stripBold(l.text))
    if (isKeyHeading || (h && chunks.some((c) => c.sec.code === h[1]))) {
      // 试卷末尾附的参考答案:大题序号从头再来 / 出现「参考答案」标题 → 之后全部归入答案原文
      flush()
      inAnswerKey = true
      if (!isKeyHeading) answerKeyLines.push(l.text)
      continue
    }
    if (h && stripBold(l.text).length < 120) {
      flush()
      const code = h[1]!
      const rest = stripBold(h[2] ?? '')
      const titleOnly = rest.split(/[（(]/)[0]!.trim()
      const meta = parseHeadingMeta(rest)
      const { itemType } = inferSectionType(titleOnly)
      const sec: RuleSection = { order: cnNum(code), code, title: titleOnly, heading: rest, instructions: '', itemType, scorePerItem: meta.scorePerItem, count: meta.count, totalScore: meta.totalScore, groups: [], flags: [], raw: '' }
      if (!itemType) sec.flags.push(flag('type_unknown', '无法从标题判断题型，请选择'))
      cur = { sec, lines: [] }
      chunks.push(cur)
      continue
    }
    if (!cur) {
      if (!draft.title) draft.title = stripBold(l.text)
      continue
    }
    cur.lines.push(l)
  }
  flush()
  if (answerKeyLines.length) draft.answerKey = answerKeyLines.join('\n')

  let expected = 1
  for (const c of chunks) {
    const sec = c.sec
    // 说明:正文开头的中文行(不含空位、不是编号题)
    const body: Line[] = []
    let inBody = false
    for (const l of c.lines) {
      const isCn = CJK.test(l.text) && !/\{\{|_{2,}| {2,}/.test(l.text)
      const isItem = !!itemLine(l.text, expected) || PASSAGE.test(l.text)
      if (!inBody && isCn && !isItem && !/^\*\*/.test(l.text.trim()) && sec.itemType !== 'writing') {
        sec.instructions = sec.instructions ? `${sec.instructions}\n${l.text.trim()}` : l.text.trim()
        continue
      }
      inBody = true
      body.push(l)
    }
    // 校订说明之类的中文注记(【…】开头)不进题目
    const clean = body.filter((l) => !/^[【\[]/.test(l.text.trim()))
    switch (sec.itemType) {
      case 'fill':
        if (/阅读填词|摘要/.test(sec.title)) parseReadingFill(sec, clean, expected)
        else parseCloze(sec, clean, expected)
        break
      case 'reorder':
        parseReorder(sec, clean, expected)
        break
      case 'short_answer':
        parseReadingQa(sec, clean, expected)
        break
      case 'translate_c2e_fill':
        parseC2E(sec, clean, expected)
        break
      case 'writing':
        parseWriting(sec, clean, expected)
        break
      default:
        parseUnknown(sec, clean, expected)
    }
    const n = sec.groups.reduce((m, g) => m + g.items.length, 0)
    if (sec.count !== null && n !== sec.count) sec.flags.push(flag('count_mismatch', `标题写共 ${sec.count} 题，实际识别 ${n} 题`))
    if (sec.scorePerItem === null) {
      if (sec.itemType === 'writing' && sec.totalScore) sec.scorePerItem = sec.totalScore
      else sec.flags.push(flag('score_missing', '标题里没有每题分值，请填写'))
    }
    if (n > 0) expected = Math.max(...sec.groups.flatMap((g) => g.items.map((i) => i.number))) + 1
  }
  if (draft.sections.length === 0) draft.sections = chunks.map((c) => c.sec)
  if (draft.sections.length === 0) draft.flags.push(flag('no_sections', '没有识别出任何大题标题（需形如「一、」「二.」）'))
  return draft
}
