// 文本规范化(SPEC §5.1):对学生答案与参考答案执行同一条流水线,顺序固定。
// 纯函数,无副作用;规范化结果同时用于匹配与「常见错答」统计。

const CURLY = new Map([
  ['‘', "'"], // '
  ['’', "'"], // '
  ['“', '"'], // "
  ['”', '"'], // "
])

// 首尾要剥掉的标点(半角为主;全角经 NFKC 已折为半角)。
const EDGE_PUNCT = /^[.,!?;:"'()。，！？；：]+|[.,!?;:"'()。，！？；：]+$/g

export interface NormalizeOptions {
  caseSensitive?: boolean
}

export function normalizeText(input: string, opts: NormalizeOptions = {}): string {
  let s = input.normalize('NFKC') // 全角 → 半角、兼容字符合并
  s = s.trim()
  if (!opts.caseSensitive) s = s.toLowerCase()
  for (const [from, to] of CURLY) s = s.split(from).join(to) // 弯引号/撇号 → 直引号
  s = s.replace(/\s+/g, ' ') // 连续空白折叠
  s = s.replace(EDGE_PUNCT, '') // 去首尾标点
  s = s.replace(/\s*-\s*/g, '-') // 连字符两侧空格去除
  return s.trim()
}

// 词数:按空白切分的非空片段数(用于 maxWords 检查;在规范化「之前」的原始输入上
// 也应得到一致结果,故只做 trim + 折叠)。
export function wordCount(input: string): number {
  const t = input.trim()
  if (!t) return 0
  return t.split(/\s+/).length
}

// 「去标点的单词序列」(SPEC §5.2 reorder):规范化后再把非字母数字撇号的字符当分隔,
// 得到纯单词数组——处理词块携带标点(如 "Can you ?"、"has completed.")的写法。
export function wordSequence(input: string): string[] {
  return normalizeText(input)
    .split(/[^a-z0-9']+/i)
    .filter((w) => w.length > 0)
}

// Levenshtein 距离(教师可选的「容错 1 字符」;考试模式永远关闭)。
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i, ...Array<number>(n).fill(0)]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min((cur[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
    }
    prev = cur
  }
  return prev[n] ?? 0
}
