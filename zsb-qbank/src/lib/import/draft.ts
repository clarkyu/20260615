import { paperSchema, type Paper } from '@/lib/schema/paper'
import type { RuleDraft, RuleFlag, RuleItem, RuleSection } from './rules'

// 规则草稿 → §4 试卷 JSON 草稿(SPEC §8 导入向导第三步):答案 / 解析留空位等 AI 结构化或教师填写;
// 经 zod 校验后把问题按路径列出(校对页标红)。纯函数。

export interface DraftIssue {
  path: string // 例:sections.2.groups.0.items.3.answer.accepted
  message: string
  source: 'rule' | 'schema' | 'ai'
}
export interface PaperMeta {
  id: string
  title: string
  year: number
  region: string
  durationMinutes: number
  source?: string
  status?: 'draft' | 'published'
}

export const SECTION_INSTRUCTION_DEFAULT: Record<string, string> = {
  fill: '每空填一词。',
  reorder: '将所给词块连成完整、正确的句子。',
  short_answer: '根据短文内容回答问题。',
  translate_e2c: '将画线句子译成汉语。',
  translate_c2e_fill: '根据汉语意思，用括号内提示词的适当形式补全英文句子。',
  writing: '按要求写作。',
}

function defaultAnswer(it: RuleItem, score: number): Record<string, unknown> {
  switch (it.type) {
    case 'fill':
    case 'reorder':
    case 'translate_c2e_fill':
      return { accepted: [] }
    case 'short_answer':
    case 'translate_e2c':
      return { reference: '', keyPoints: [], rubric: '' }
    case 'writing':
      return {
        sample: '',
        rubric: [
          { name: '内容', maxScore: Math.round(score * 0.4 * 2) / 2, desc: '要点齐全、切题' },
          { name: '语言', maxScore: Math.round(score * 0.4 * 2) / 2, desc: '语法与用词准确' },
          { name: '结构与字数', maxScore: score - Math.round(score * 0.4 * 2) / 2 * 2, desc: '格式规范、达到字数' },
        ],
      }
    default:
      return { correct: [] }
  }
}

function composeInstructions(sec: RuleSection): string {
  const parts: string[] = []
  if (sec.count !== null && sec.scorePerItem !== null) parts.push(`共 ${sec.count} 小题，每小题 ${sec.scorePerItem} 分，共 ${sec.totalScore ?? sec.count * sec.scorePerItem} 分。`)
  else if (sec.scorePerItem !== null) parts.push(`每小题 ${sec.scorePerItem} 分。`)
  if (sec.instructions) parts.push(sec.instructions.replace(/\n+/g, ' '))
  else if (sec.itemType) parts.push(SECTION_INSTRUCTION_DEFAULT[sec.itemType] ?? '')
  return parts.join('').trim()
}

/** 规则草稿转试卷 JSON(未必通过 zod;issues 列出缺口)。 */
export function ruleDraftToPaper(rule: RuleDraft, meta: PaperMeta): { paper: Paper; issues: DraftIssue[] } {
  const issues: DraftIssue[] = []
  const push = (path: string, f: RuleFlag, source: DraftIssue['source'] = 'rule') => issues.push({ path, message: f.message, source })
  for (const f of rule.flags) push('', f)
  const sections = rule.sections.map((sec, si) => {
    const sp = `sections.${si}`
    for (const f of sec.flags) push(sp, f)
    const itemType = sec.itemType ?? 'fill'
    const scorePerItem = sec.scorePerItem ?? (itemType === 'writing' ? 10 : 2)
    return {
      order: si + 1,
      code: sec.code,
      title: sec.title,
      instructions: composeInstructions(sec),
      itemType,
      scorePerItem,
      groups: sec.groups.map((g, gi) => {
        const gp = `${sp}.groups.${gi}`
        for (const f of g.flags) push(gp, f)
        return {
          order: g.order,
          kind: g.kind,
          ...(g.stimulus ? { stimulus: g.stimulus } : {}),
          ...(g.frame ? { frame: g.frame } : {}),
          items: g.items.map((it, ii) => {
            const ip = `${gp}.items.${ii}`
            for (const f of it.flags) push(ip, f)
            if (it.numberInferred) push(`${ip}.number`, { code: 'number_inferred', message: '题号为推断值，请确认' })
            const score = it.type === 'writing' ? (sec.totalScore ?? scorePerItem) : scorePerItem
            return {
              number: it.number,
              type: it.type,
              score,
              knowledgeTags: [] as string[],
              difficulty: 2 as const,
              ...(it.contextSnippet ? { contextSnippet: it.contextSnippet } : {}),
              content: it.content,
              answer: defaultAnswer(it, score),
              origin: 'official' as const,
              status: 'draft' as const,
            }
          }),
        }
      }),
    }
  })
  const totalScore = sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.items.reduce((k, it) => k + it.score, 0), 0), 0)
  const paper = {
    schemaVersion: 1,
    id: meta.id,
    title: meta.title,
    year: meta.year,
    region: meta.region,
    ...(meta.source ? { source: meta.source } : {}),
    totalScore: totalScore || 100,
    durationMinutes: meta.durationMinutes,
    status: meta.status ?? 'draft',
    sections,
  } as unknown as Paper
  return { paper, issues }
}

/** zod 校验并把错误转成路径问题(与规则问题合并去重)。 */
export function validateDraft(paper: unknown, extra: DraftIssue[] = []): { ok: boolean; issues: DraftIssue[]; paper?: Paper } {
  const parsed = paperSchema.safeParse(paper)
  const issues: DraftIssue[] = [...extra]
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      const path = i.path.join('.')
      const missingAnswer = /\.answer\.(accepted|reference|sample)$/.test(path) && (i.code === 'too_small' || i.code === 'invalid_type')
      const message = missingAnswer ? '缺少参考答案' : i.message
      if (!issues.some((x) => x.path === path && x.message === message)) issues.push({ path, message, source: 'schema' })
    }
  }
  // 题号全卷唯一(items 表有 (paper_id, number) 唯一索引,重复会在入库时 500):按路径报出来。
  const seen = new Map<number, string>()
  const p = paper as { sections?: Array<{ groups?: Array<{ items?: Array<{ number?: unknown }> }> }> } | null
  p?.sections?.forEach((sec, si) =>
    sec.groups?.forEach((g, gi) =>
      g.items?.forEach((it, ii) => {
        if (typeof it.number !== 'number') return
        const path = `sections.${si}.groups.${gi}.items.${ii}.number`
        const first = seen.get(it.number)
        if (first) issues.push({ path, message: `题号 ${it.number} 重复（另一处在 ${first}）`, source: 'schema' })
        else seen.set(it.number, path)
      }),
    ),
  )
  const ok = parsed.success && issues.every((i) => i.source !== 'schema')
  return parsed.success ? { ok, issues, paper: parsed.data } : { ok: false, issues }
}

/** 把试卷 JSON 的 totalScore 与各小题分值对齐(教师改分后重算)。 */
export function recomputeTotal(paper: Paper): Paper {
  const total = paper.sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.items.reduce((k, it) => k + it.score, 0), 0), 0)
  return { ...paper, totalScore: total }
}

/** 由标题推一个 id(slug):hubei-zsb-english-2026 之类;教师可改。 */
export function suggestPaperId(title: string, year: number): string {
  const region = /湖北/.test(title) ? 'hubei' : /全国/.test(title) ? 'national' : 'paper'
  // 本题库只有《大学英语》一科:标题没写科目也按 english
  const subj = /数学|计算机|语文|政治/.test(title) ? 'subject' : 'english'
  return `${region}-zsb-${subj}-${year}`
}
export function suggestYear(title: string | null): number {
  const m = /(20\d{2})/.exec(title ?? '')
  return m ? Number(m[1]) : new Date().getFullYear()
}
