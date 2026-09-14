// 学生答案相似度(SPEC §8 批改队列「同一小题批量浏览,按相似度排序」):纯函数。
// 词级 + 字符二元组的 Dice 系数取较大值(短答案靠字符,长答案靠词),再用最近邻链把相似
// 作答排到一起——老师连续看到几乎一样的答案,给一次分就能顺手复用。

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
function dice(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1
  if (a.length === 0 || b.length === 0) return 0
  const count = new Map<string, number>()
  for (const x of a) count.set(x, (count.get(x) ?? 0) + 1)
  let hit = 0
  for (const y of b) {
    const n = count.get(y) ?? 0
    if (n > 0) {
      hit++
      count.set(y, n - 1)
    }
  }
  return (2 * hit) / (a.length + b.length)
}

/** 0..1;完全相同 1,毫无交集 0。 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  return Math.max(dice(tokens(a), tokens(b)), dice(bigrams(a), bigrams(b)))
}

/**
 * 最近邻链排序:从第一条开始,每次挑与「上一条」最相似的未访问项接上。O(n²),
 * 批改队列单题几十到几百条足够。稳定:相似度相同按原顺序。
 */
export function orderBySimilarity<T>(rows: T[], text: (row: T) => string): T[] {
  if (rows.length <= 2) return [...rows]
  const texts = rows.map(text)
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
      const s = similarity(texts[cur]!, texts[i]!)
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
