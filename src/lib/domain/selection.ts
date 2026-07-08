import { parseChoices } from '@/lib/choices'

// 甲·分流的路由「大脑」——纯函数,便于穷举测试。给定一份作业的有序环节 + 学生在选题环节里的
// 选择(选题环节提交的 recitedText),算出这个学生实际要做的环节集合。
//
// 规则:
// - 未设 branchTopicsJson(null / 空数组)的环节 = 公共环节,人人都做(含选题环节自己)。
// - 设了 branchTopicsJson 的环节 = 分流门:仅当学生的选择 ∈ 该题目集合时才纳入。
// - 学生还没选题(chosenTopic = null):带门环节一律不纳入(前端显示为「待选题解锁」),
//   公共环节照常。
//
// 匹配按题目原文(去首尾空白)——与投票计票、归票同一套「recitedText 对 choicesJson 文本匹配」
// 的连接约定,所以学生已存的选择直接就是分流依据,零映射。

export function branchTopicsOf(branchTopicsJson: string | null | undefined): string[] {
  return branchTopicsJson ? parseChoices(branchTopicsJson).map((t) => t.trim()).filter(Boolean) : []
}

export function isPhaseActiveFor(branchTopicsJson: string | null | undefined, chosenTopic: string | null): boolean {
  const topics = branchTopicsOf(branchTopicsJson)
  if (topics.length === 0) return true // 公共环节
  return chosenTopic != null && topics.includes(chosenTopic.trim())
}

export function activePhasesFor<T extends { branchTopicsJson?: string | null }>(phases: T[], chosenTopic: string | null): T[] {
  return phases.filter((p) => isPhaseActiveFor(p.branchTopicsJson, chosenTopic))
}
