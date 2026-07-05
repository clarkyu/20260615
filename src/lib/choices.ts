// 单选投票选项的存取：Phase.choicesJson 是一个 JSON 字符串数组（["选项一","选项二",…]）。
// 容错解析成 string[]（坏数据/空 → []），并去掉空白项；UI 编辑用数组，落库前 JSON.stringify。
export function parseChoices(json: string | null | undefined): string[] {
  if (!json) return []
  try {
    const arr: unknown = JSON.parse(json)
    if (!Array.isArray(arr)) return []
    return arr.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

// Compare two option-text lists as SETS — order- and duplicate-insensitive, trimmed,
// empties dropped. The multi-select (多选题) judge is all-or-nothing: full marks iff the
// student's selected set equals the correct set. Used by the objective grading branch.
export function sameChoiceSet(a: string[], b: string[]): boolean {
  const norm = (xs: string[]) => new Set(xs.map((x) => x.trim()).filter(Boolean))
  const sa = norm(a)
  const sb = norm(b)
  if (sa.size !== sb.size) return false
  for (const x of sa) if (!sb.has(x)) return false
  return true
}
