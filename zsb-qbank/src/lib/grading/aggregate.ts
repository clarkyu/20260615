import { isObjectiveType } from './objective'
import type { Item } from '@/lib/schema/paper'

// 成绩汇总(SPEC §10 M3:成绩页分大题显示得分与逐题对错)。纯函数,不碰数据库。
// 约定:客观题交卷即有分;主观题已答未评 → score=null、verdict='pending';
// 未作答一律 verdict='empty'、0 分。

export interface ItemMeta {
  id: string
  number: number
  type: string
  score: number
}

/** responses 表里该题的落库判分状态(未答则无记录)。 */
export interface SavedGrade {
  score: number | null
  verdict: string | null
}

export interface ItemResult {
  itemId: string
  number: number
  fullScore: number
  objective: boolean
  /** correct / wrong / too_many_words / empty / pending / graded */
  verdict: string
  /** null = 待评(主观题) */
  score: number | null
}

export function itemResult(meta: ItemMeta, saved: SavedGrade | undefined): ItemResult {
  const objective = isObjectiveType(meta.type as Item['type'])
  const base = { itemId: meta.id, number: meta.number, fullScore: meta.score, objective }
  if (!saved) return { ...base, verdict: 'empty', score: 0 }
  if (objective) return { ...base, verdict: saved.verdict ?? 'wrong', score: saved.score ?? 0 }
  if (saved.score === null) return { ...base, verdict: 'pending', score: null }
  return { ...base, verdict: saved.verdict ?? 'graded', score: saved.score }
}

export interface SectionSummary {
  id: string
  title: string
  fullScore: number
  /** 已得分(计入已判项;主观题待评不计入) */
  score: number
  /** 待评小题数 */
  pending: number
  items: ItemResult[]
}

export interface ResultSummary {
  sections: SectionSummary[]
  total: { score: number; fullScore: number; pending: number; empty: number }
}

export function summarize(
  sections: { id: string; title: string; items: ItemMeta[] }[],
  savedByItem: Map<string, SavedGrade>,
): ResultSummary {
  const out: SectionSummary[] = []
  let score = 0
  let fullScore = 0
  let pending = 0
  let empty = 0
  for (const s of sections) {
    const rows = s.items.map((m) => itemResult(m, savedByItem.get(m.id)))
    const sScore = rows.reduce((n, r) => n + (r.score ?? 0), 0)
    const sFull = rows.reduce((n, r) => n + r.fullScore, 0)
    const sPending = rows.filter((r) => r.verdict === 'pending').length
    score += sScore
    fullScore += sFull
    pending += sPending
    empty += rows.filter((r) => r.verdict === 'empty').length
    out.push({ id: s.id, title: s.title, fullScore: sFull, score: sScore, pending: sPending, items: rows })
  }
  return { sections: out, total: { score, fullScore, pending, empty } }
}

/** 参考答案与解析何时可见(SPEC §6):练习即时;考试在教师发布(released)后。 */
export function revealAnswers(mode: string, status: string): boolean {
  return mode === 'practice' || status === 'released'
}
