// 填空题的存取与判分核心（纯函数、可测）。
//
// Phase.blanksJson = { text, accept }：
//  · text   题干，用 ____（≥3 个连续下划线）标一个空，空的个数 = 标记个数；
//  · accept 每个空的可接受答案数组（大小写 / 首尾空白不敏感，任一命中即该空对）。
// 学生作答存 Submission.recitedText，为「逐空答案」的 JSON 字符串数组（与空同序）。
// 判分按空给分：答对空数 / 总空数 × 满分。

export interface FillBlank {
  text: string
  accept: string[][]
}

// ≥3 个连续下划线视作一个空。学生端按同一规则 split 出输入框。
export const BLANK_RE = /_{3,}/g

export function blankCount(text: string): number {
  return (text.match(BLANK_RE) ?? []).length
}

// 把题干按空切成「段」，段之间即一个空：segments.length - 1 == 空数。
export function splitBlanks(text: string): string[] {
  return text.split(BLANK_RE)
}

// 容错解析 blanksJson → {text, accept}（坏数据 → 空题）。accept 里每项过滤成 string[]。
export function parseFillBlank(json: string | null | undefined): FillBlank {
  if (!json) return { text: '', accept: [] }
  try {
    const o = JSON.parse(json) as { text?: unknown; accept?: unknown }
    const text = typeof o?.text === 'string' ? o.text : ''
    const accept = Array.isArray(o?.accept)
      ? o.accept.map((a) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []))
      : []
    return { text, accept }
  } catch {
    return { text: '', accept: [] }
  }
}

// 答案键是否可用于客观判分：空数与题干标记一致，且每个空恰有一组非空可接受答案。
// 不可用（blanksJson 缺失/损坏、老师漏填答案键、空数不符）时**不应自动判 0**——
// 否则整班静默得 0 且不进复核；调用方应转老师人工复核。
export function isGradableFillBlank(fb: FillBlank): boolean {
  return (
    fb.accept.length > 0 &&
    fb.accept.length === blankCount(fb.text) &&
    fb.accept.every((a) => a.length > 0)
  )
}

// Normalize before comparing a student's blank answer to the accepted keys. Both sides go
// through this, so matching is lenient in the ways that are typos, not knowledge:
//  · NFKC folds full-width forms (常见于中文输入法：Ｎｅｗ / ２ / ，) to their ASCII
//    equivalents, so a full-width answer isn't wrongly scored 0 on an objective blank;
//  · internal whitespace collapses ("New  York" == "New York");
//  · trim + lowercase (case-insensitive).
const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

// 逐空判分：answers[i] 命中 accept[i] 里任一（归一化后相等且非空）即该空对。
// total = accept.length（题面定义的空数）。
export function gradeFillBlank(answers: string[], accept: string[][]): { correct: number; total: number } {
  let correct = 0
  for (let i = 0; i < accept.length; i++) {
    const ans = norm(answers[i] ?? '')
    if (!ans) continue
    if (accept[i].some((a) => norm(a) === ans)) correct++
  }
  return { correct, total: accept.length }
}
