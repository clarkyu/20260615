// 教师端小题一行摘要(组卷勾选、批改队列、学情表共用):题号 + 题型中文 + 内容前几十字。
// 纯函数,不带答案。

export const ITEM_TYPE_LABEL: Record<string, string> = {
  fill: '填词',
  reorder: '排序',
  short_answer: '简答',
  translate_e2c: '英译汉',
  translate_c2e_fill: '汉译英',
  writing: '写作',
  single_choice: '单选',
  multi_choice: '多选',
  true_false: '判断',
}

export const MODE_LABEL: Record<string, string> = { practice: '练习', training: '训练', exam: '考试' }
export const ATTEMPT_STATUS_LABEL: Record<string, string> = {
  not_started: '未开始',
  in_progress: '作答中',
  submitted: '已交卷',
  graded: '已评分',
  released: '已发布',
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function clip(s: string, n = 48): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

/** 小题内容摘要(不含答案)。 */
export function itemPreview(type: string, content: unknown, contextSnippet?: string | null): string {
  const c = obj(content)
  switch (type) {
    case 'fill':
      return clip(contextSnippet ?? str(c.hint) ?? '') || `第 ${String(c.blank ?? '?')} 空`
    case 'reorder': {
      const chunks = Array.isArray(c.chunks) ? c.chunks.filter((x): x is string => typeof x === 'string') : []
      return clip(chunks.join(' / '))
    }
    case 'short_answer':
      return clip(str(c.question))
    case 'translate_e2c':
      return clip(str(c.source))
    case 'translate_c2e_fill':
      return clip(str(c.zh) || str(c.source) || str(c.frame))
    case 'writing':
      return clip(str(c.title) || str(c.prompt) || str(c.topic))
    case 'single_choice':
    case 'multi_choice':
    case 'true_false':
      return clip(str(c.stem))
    default:
      return clip(JSON.stringify(content ?? ''))
  }
}

/** 展示时区:师生都在国内,固定北京时间——服务器容器多为 UTC,且服务端 / 客户端输出一致才不会水合不匹配。 */
export const DISPLAY_TIME_ZONE = 'Asia/Shanghai'
const fullFmt = new Intl.DateTimeFormat('zh-CN', { timeZone: DISPLAY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const shortFmt = new Intl.DateTimeFormat('zh-CN', { timeZone: DISPLAY_TIME_ZONE, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

function parts(f: Intl.DateTimeFormat, t: Date): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of f.formatToParts(t)) out[p.type] = p.value
  return out
}
/** 2026-09-14 12:00(北京时间) */
export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const t = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(t.getTime())) return '—'
  const p = parts(fullFmt, t)
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}
/** 9/14 12:00(学生卡片用的短格式) */
export function fmtTimeShort(d: Date | string | null | undefined): string {
  if (!d) return ''
  const t = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(t.getTime())) return ''
  const p = parts(shortFmt, t)
  return `${p.month}/${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}
