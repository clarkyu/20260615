import { normalizeText } from '@/lib/grading/normalize'

// accepted 候选(SPEC §8「`accepted` 候选(来自 AI 兜底)在此采纳或拒绝」)。
//
// 汉译英填空的答案键是穷举不完的:学生写了个词表里没有、但确实对的说法,
// 判分兜底会送 AI,AI 说「可接受」就给满分 —— 但**答案键学不到它**。
// 于是下一个学生写同样的答案,还要再送一次 AI:既花钱,又可能两次判得不一样。
// 这里把这些答案收集成候选,老师点一下就写进 answer.accepted,以后按规则判、不再问 AI。
//
// 纯函数放这儿(去重、排除、合并),SQL 只负责把行捞出来。

export interface RawCandidate {
  /** 学生原文(展示给老师看的那一份) */
  text: string
  /** 出现次数 */
  count: number
  /** 最近一次出现 */
  lastSeenAt?: Date | string | null
}

export interface Candidate {
  /** 展示用原文:同一规范化形式下取出现次数最多的那个写法 */
  text: string
  /** 规范化形式(判重、比对答案键都用它) */
  normalized: string
  count: number
  lastSeenAt: string | null
}

const norm = (s: string) => normalizeText(s)

/**
 * 归拢候选:按规范化形式合并计数,排除已在答案键里的、以及老师已判为错答的,
 * 然后按出现次数降序(同次数按最近出现)排。
 */
export function collectCandidates(
  rows: RawCandidate[],
  opts: { accepted?: string[]; rejected?: string[] } = {},
): Candidate[] {
  const accepted = new Set((opts.accepted ?? []).map(norm))
  const rejected = new Set((opts.rejected ?? []).map(norm))
  const byNorm = new Map<string, { texts: Map<string, number>; count: number; lastSeenAt: number | null }>()

  for (const r of rows) {
    const text = (r.text ?? '').trim()
    if (!text) continue
    const n = norm(text)
    if (!n || accepted.has(n) || rejected.has(n)) continue
    const count = Number.isFinite(r.count) && r.count > 0 ? Math.floor(r.count) : 1
    const at = r.lastSeenAt ? new Date(r.lastSeenAt).getTime() : null
    const hit = byNorm.get(n)
    if (hit) {
      hit.count += count
      hit.texts.set(text, (hit.texts.get(text) ?? 0) + count)
      if (at !== null && (hit.lastSeenAt === null || at > hit.lastSeenAt)) hit.lastSeenAt = at
    } else {
      byNorm.set(n, { texts: new Map([[text, count]]), count, lastSeenAt: at })
    }
  }

  return [...byNorm.entries()]
    .map(([normalized, v]) => {
      // 展示取最常见的写法;并列时取更「干净」的那个(短的,多打了空格的排后面),
      // 最后按字典序定死,免得每次刷新换一个写法。
      const text = [...v.texts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0]![0]
      return { text, normalized, count: v.count, lastSeenAt: v.lastSeenAt === null ? null : new Date(v.lastSeenAt).toISOString() }
    })
    .sort((a, b) => b.count - a.count || (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '') || a.normalized.localeCompare(b.normalized))
}

/** 答案键上限:防手滑把几百条都采纳进去(判分要逐条比,也不该无限长)。 */
export const MAX_ACCEPTED = 50

export interface MergeResult {
  accepted: string[]
  /** 真正新加进去的(已存在的会被忽略) */
  added: string[]
  /** 因为重复而没加的 */
  duplicates: string[]
  /** 因为超出上限而没加的 */
  overflow: string[]
}

/**
 * 把采纳的答案并进答案键:保留原有顺序与写法,新答案按传入顺序追加,
 * 规范化后重复的不加(答案键里留两条只差大小写的没有意义)。
 */
export function mergeAccepted(existing: string[], adopt: string[]): MergeResult {
  const out = [...existing]
  const seen = new Set(existing.map(norm))
  const added: string[] = []
  const duplicates: string[] = []
  const overflow: string[] = []

  for (const raw of adopt) {
    const text = (raw ?? '').trim()
    if (!text) continue
    const n = norm(text)
    if (!n) continue
    if (seen.has(n)) {
      duplicates.push(text)
      continue
    }
    if (out.length >= MAX_ACCEPTED) {
      overflow.push(text)
      continue
    }
    out.push(text)
    seen.add(n)
    added.push(text)
  }
  return { accepted: out, added, duplicates, overflow }
}
