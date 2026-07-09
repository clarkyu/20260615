// 评分标准（rubric，纯文字「怎么评」）与分值（rubricPoints，各维度点数）分离——老师分开编辑。
// 评分时代码把两者拼成判分看的 rubric prompt，满分取分值之和。都不靠 LLM 算术：分值由代码求和给满分。

export interface RubricPoint {
  name: string
  points: number
}

// 安全解析 Phase.rubricPoints（JSON 字符串）。坏数据/空 → []（回退到「无分值」= 满分默认）。
// 只收 {name:非空字符串, points:有限非负数} 的项;其余丢弃。
export function parseRubricPoints(json: string | null | undefined): RubricPoint[] {
  if (!json) return []
  try {
    const raw = JSON.parse(json)
    if (!Array.isArray(raw)) return []
    return raw
      .map((r): RubricPoint | null => {
        const name = typeof r?.name === 'string' ? r.name.trim() : ''
        const points = Number(r?.points)
        if (!name || !Number.isFinite(points) || points < 0) return null
        return { name, points: Math.round(points) }
      })
      .filter((r): r is RubricPoint => r !== null)
  } catch {
    return []
  }
}

// 各维度分值之和 = 满分。无分值 → null（调用方回退到默认满分）。
export function rubricMaxScore(points: RubricPoint[]): number | null {
  if (points.length === 0) return null
  return points.reduce((sum, p) => sum + p.points, 0)
}

// 把「标准」文字 + 「分值」拼成判分看的 rubric。分值渲染成一行明细并点明满分（= 各维度之和），
// 让判分按各维度点数配比给分。无分值 → 原样返回标准文字（满分由调用方用默认值）。
export function composeRubric(criteria: string, points: RubricPoint[]): { text: string; maxScore: number | null } {
  const max = rubricMaxScore(points)
  if (max === null) return { text: criteria, maxScore: null }
  const detail = points.map((p) => `${p.name} ${p.points}`).join('、')
  const text = `${criteria}\n\n【各维度分值】${detail}（满分 ${max}，请按各维度分值配比给分）。`
  return { text, maxScore: max }
}
