// 学生答案相似度(SPEC §8 批改队列「同一小题批量浏览,按相似度排序」):纯函数。
// 词级 + 字符二元组的 Dice 系数取较大值(短答案靠字符,长答案靠词),再用最近邻链把相似
// 作答排到一起——老师连续看到几乎一样的答案,给一次分就能顺手复用。
// 性能:每条答案只分词 / 切二元组一次(预计算多重集),排序阶段 O(n²) 只做计数比较,500 条量级毫秒级。

type Multiset = { counts: Map<string, number>; size: number }

function multiset(list: string[]): Multiset {
  const counts = new Map<string, number>()
  for (const x of list) counts.set(x, (counts.get(x) ?? 0) + 1)
  return { counts, size: list.length }
}
function tokens(s: string): string[] {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}
function bigrams(s: string): string[] {
  const t = s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
  const out: string[] = []
  for (let i = 0; i + 1 < t.length; i++) out.push(t.slice(i, i + 2))
  return out
}
/** Dice 系数;任一方为空多重集时为 0(单字符答案没有二元组,不能因此判成「完全相同」)。 */
function dice(a: Multiset, b: Multiset): number {
  if (a.size === 0 || b.size === 0) return 0
  const [small, big] = a.counts.size <= b.counts.size ? [a, b] : [b, a]
  let hit = 0
  for (const [k, n] of small.counts) {
    const m = big.counts.get(k)
    if (m) hit += Math.min(n, m)
  }
  return (2 * hit) / (a.size + b.size)
}

interface Prepared {
  text: string
  words: Multiset
  chars: Multiset
}
function prepare(text: string): Prepared {
  return { text, words: multiset(tokens(text)), chars: multiset(bigrams(text)) }
}
function simPrepared(a: Prepared, b: Prepared): number {
  if (a.text === b.text) return 1
  return Math.max(dice(a.words, b.words), dice(a.chars, b.chars))
}

/** 0..1;完全相同 1,毫无交集 0。 */
export function similarity(a: string, b: string): number {
  return simPrepared(prepare(a), prepare(b))
}

/**
 * 最近邻链排序:从第一条开始,每次挑与「上一条」最相似的未访问项接上。O(n²) 次多重集比较,
 * 批改队列单题几十到几百条足够。稳定:相似度相同按原顺序。
 */
export function orderBySimilarity<T>(rows: T[], text: (row: T) => string): T[] {
  if (rows.length <= 2) return [...rows]
  const prepared = rows.map((r) => prepare(text(r)))
  const used = new Array<boolean>(rows.length).fill(false)
  const out: T[] = []
  let cur = 0
  used[0] = true
  out.push(rows[0]!)
  while (out.length < rows.length) {
    let best = -1
    let bestSim = -1
    for (let i = 0; i < rows.length; i++) {
      if (used[i]) continue
      const s = simPrepared(prepared[cur]!, prepared[i]!)
      if (s > bestSim) {
        bestSim = s
        best = i
      }
    }
    used[best] = true
    out.push(rows[best]!)
    cur = best
  }
  return out
}
