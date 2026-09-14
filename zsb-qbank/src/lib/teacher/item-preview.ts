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
      return clip(str(c.chinese) || str(c.source) || str(c.frame))
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

export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const t = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(t.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`
}
