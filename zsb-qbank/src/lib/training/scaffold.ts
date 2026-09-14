// 三级脚手架(SPEC §6):针对 fill 与 translate_c2e_fill。
//   一级 选词块:正确答案 + 三个干扰变形(content.distractors,AI 生成、教师审核)
//   二级 首字母 + 字母数(b _ _ _ _ _ _)
//   三级 自由拼写
// 升降规则:答对升一级;答错降一级;三级连续两次答对 → 该题脚手架永久关闭。纯函数。

export type ScaffoldLevel = 1 | 2 | 3

export interface ScaffoldState {
  level: ScaffoldLevel
  l3Streak: number
  off: boolean
}

export const INITIAL_SCAFFOLD: ScaffoldState = { level: 1, l3Streak: 0, off: false }
export const SCAFFOLD_TYPES = new Set(['fill', 'translate_c2e_fill'])

export function nextScaffold(state: ScaffoldState, correct: boolean): ScaffoldState {
  if (state.off) return { ...state, level: 3 }
  if (correct) {
    if (state.level === 3) {
      const l3Streak = state.l3Streak + 1
      return { level: 3, l3Streak, off: l3Streak >= 2 }
    }
    return { level: (state.level + 1) as ScaffoldLevel, l3Streak: 0, off: false }
  }
  return { level: Math.max(1, state.level - 1) as ScaffoldLevel, l3Streak: 0, off: false }
}

export interface ScaffoldHint {
  /** 实际生效的等级(没有干扰项时一级退化为二级;关闭后固定三级) */
  level: ScaffoldLevel
  off: boolean
  /** 一级:候选词块(含正确答案,顺序稳定打乱) */
  options?: string[]
  /** 二级:首字母 + 下划线掩码,如 "b _ _ _ _ _ _";多词答案逐词掩码 */
  mask?: string
}

/** 稳定打乱(同一题每次顺序一致,避免刷新后位置变动被记住)。 */
function seededOrder(list: string[], seed: string): string[] {
  let h = 2166136261
  for (const ch of seed) h = (h ^ ch.charCodeAt(0)) * 16777619
  const scored = list.map((v, i) => ({ v, k: ((h * (i + 1)) >>> 0) % 1000 }))
  scored.sort((a, b) => a.k - b.k || a.v.localeCompare(b.v))
  return scored.map((s) => s.v)
}

export function maskWord(answer: string): string {
  return answer
    .trim()
    .split(/\s+/)
    .map((w) => {
      // 单字母答案(a / I)只给字母数,否则等于直接给答案
      if (w.length <= 1) return /[A-Za-z]/.test(w) ? '_' : w
      const letters = w.split('')
      return [letters[0], ...letters.slice(1).map((ch) => (/[A-Za-z]/.test(ch) ? '_' : ch))].join(' ')
    })
    .join('   ')
}

/**
 * 按等级生成客户端提示。answer 为参考答案(第一条 accepted);distractors 来自 content。
 * 注意:一级 / 二级的提示本身就包含答案信息,这是 SPEC §6 的设计(训练模式),不用于练习 / 考试。
 */
export function scaffoldHint(state: ScaffoldState, answer: string, distractors: string[] | undefined, seed: string): ScaffoldHint {
  if (state.off) return { level: 3, off: true }
  let level = state.level
  if (level === 1) {
    const pool = (distractors ?? []).map((d) => d.trim()).filter((d) => d && d.toLowerCase() !== answer.trim().toLowerCase())
    if (pool.length >= 2) {
      const options = seededOrder([answer.trim(), ...pool.slice(0, 3)], seed)
      return { level: 1, off: false, options }
    }
    level = 2 // 没有干扰项:退化为首字母提示
  }
  if (level === 2) return { level: 2, off: false, mask: maskWord(answer) }
  return { level: 3, off: false }
}
