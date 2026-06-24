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
