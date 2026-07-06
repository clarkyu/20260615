// 展示载荷用的文本截断:结果长度 ≤ max(省略号计入),不劈开代理对(emoji 等)。
// 只用于「发给前端展示」的文本——数据库里的原文与留痕(voteSourceText)一律不动。
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  let cut = max - 1
  const hi = text.charCodeAt(cut - 1)
  if (hi >= 0xd800 && hi <= 0xdbff) cut -= 1 // 截点落在代理对中间则整对丢弃
  return `${text.slice(0, cut)}…`
}
