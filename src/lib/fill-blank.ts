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

// 判分归一化：Unicode NFKC（把中文输入法常见的全角字母/数字/标点折成半角、合并兼容字符）
// → 折叠内部连续空白为单个空格 → 去首尾空白 → 转小写。学生答案与答案键都过同一 norm，
// 所以「New  York」（内部双空格）、「Ｎｅｗ」（全角）这类等价写法不再被误判为错（审计 P2-11）。
const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

// 答案键是否可用于客观判分：空数与题干标记一致，且每个空至少有一个「归一化后非空」的可接受答案。
// 不可用（blanksJson 缺失/损坏、老师漏填答案键、空数不符、某空只有空串答案）时**不应自动判 0**——
// 否则整班静默得 0 且不进复核；调用方应转老师人工复核。
export function isGradableFillBlank(fb: FillBlank): boolean {
  return (
    fb.accept.length > 0 &&
    fb.accept.length === blankCount(fb.text) &&
    // 每空须有至少一个归一化后非空的答案。只有空串（或折成空白）的答案键，gradeFillBlank 永远
    // 判不对（它跳过空的学生作答），会把整班静默判 0 而非转人工——按不可判分处理（审计 A15）。
    fb.accept.every((a) => a.some((x) => norm(x) !== ''))
  )
}

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
