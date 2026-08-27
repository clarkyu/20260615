// 客户端安全的试卷视图类型(答案已在服务端剥离)。content 为各题型的内容对象;
// 这里提供窄化助手,客户端渲染前用它读取字段,坏数据回退为安全默认值。

export interface PlayItem {
  id: string
  number: number
  type: string
  score: number
  content: unknown
  knowledgeTags: string[]
  difficulty: number
  contextSnippet: string | null
}
export interface PlayGroup {
  id: string
  order: number
  kind: string
  stimulus: { kind: string; title?: string; body: string } | null
  frame: string | null
  items: PlayItem[]
}
export interface PlaySection {
  id: string
  order: number
  code: string
  title: string
  instructions: string
  itemType: string
  scorePerItem: number
  groups: PlayGroup[]
}
export interface PlayPaper {
  id: string
  title: string
  totalScore: number
  durationMinutes: number
  sections: PlaySection[]
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export const fillContent = (c: unknown) => {
  const o = obj(c)
  return { blank: num(o.blank, 0), hint: typeof o.hint === 'string' ? o.hint : undefined, maxWords: num(o.maxWords, 1) }
}
export const reorderContent = (c: unknown) => ({ chunks: strArr(obj(c).chunks) })
export const questionContent = (c: unknown) => ({ question: str(obj(c).question), source: str(obj(c).source) })
export const c2eContent = (c: unknown) => {
  const o = obj(c)
  return { zh: str(o.zh), frame: str(o.frame), hint: typeof o.hint === 'string' ? o.hint : undefined, maxWords: num(o.maxWords, 2) }
}
export const writingContent = (c: unknown) => {
  const o = obj(c)
  return { prompt: str(o.prompt), requirements: strArr(o.requirements), minWords: num(o.minWords, 40), genre: str(o.genre) }
}
