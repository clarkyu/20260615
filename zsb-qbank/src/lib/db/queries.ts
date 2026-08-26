import { asc, eq } from 'drizzle-orm'
import type { Db } from './client'
import { users, papers, sections, groups, items } from './schema'
import type { SessionUser } from '@/lib/auth/session'

// 只读装配与通用查询。装配出的「带 id 试卷树」仅存在于服务端;
// 发往客户端前必须经过 stripAnswers(硬约束 1)。

export interface DbItemRow {
  id: string
  number: number
  type: string
  score: number
  content: unknown
  answer: unknown
  explanation: string | null
  knowledgeTags: string[]
  difficulty: number
  contextSnippet: string | null
}

export interface AssembledGroup {
  id: string
  order: number
  kind: string
  stimulus: unknown
  frame: string | null
  items: DbItemRow[]
}

export interface AssembledSection {
  id: string
  order: number
  code: string
  title: string
  instructions: string
  itemType: string
  scorePerItem: number
  groups: AssembledGroup[]
}

export interface AssembledPaper {
  id: string
  title: string
  year: number
  region: string
  totalScore: number
  durationMinutes: number
  status: string
  sections: AssembledSection[]
}

export async function assemblePaper(db: Db, paperId: string): Promise<AssembledPaper | null> {
  const paper = await db.query.papers.findFirst({ where: eq(papers.id, paperId) })
  if (!paper) return null
  const sectionRows = await db.select().from(sections).where(eq(sections.paperId, paperId)).orderBy(asc(sections.order))
  const groupRows = await db
    .select({ g: groups })
    .from(groups)
    .innerJoin(sections, eq(groups.sectionId, sections.id))
    .where(eq(sections.paperId, paperId))
    .orderBy(asc(groups.order))
  const itemRows = await db.select().from(items).where(eq(items.paperId, paperId)).orderBy(asc(items.number))

  const itemsByGroup = new Map<string, DbItemRow[]>()
  for (const it of itemRows) {
    const list = itemsByGroup.get(it.groupId) ?? []
    list.push({
      id: it.id,
      number: it.number,
      type: it.type,
      score: it.score,
      content: it.content,
      answer: it.answer,
      explanation: it.explanation,
      knowledgeTags: it.knowledgeTags,
      difficulty: it.difficulty,
      contextSnippet: it.contextSnippet,
    })
    itemsByGroup.set(it.groupId, list)
  }
  const groupsBySection = new Map<string, AssembledGroup[]>()
  for (const { g } of groupRows) {
    const list = groupsBySection.get(g.sectionId) ?? []
    list.push({ id: g.id, order: g.order, kind: g.kind, stimulus: g.stimulus, frame: g.frame, items: itemsByGroup.get(g.id) ?? [] })
    groupsBySection.set(g.sectionId, list)
  }
  return {
    id: paper.id,
    title: paper.title,
    year: paper.year,
    region: paper.region,
    totalScore: paper.totalScore,
    durationMinutes: paper.durationMinutes,
    status: paper.status,
    sections: sectionRows.map((s) => ({
      id: s.id,
      order: s.order,
      code: s.code,
      title: s.title,
      instructions: s.instructions,
      itemType: s.itemType,
      scorePerItem: s.scorePerItem,
      groups: groupsBySection.get(s.id) ?? [],
    })),
  }
}

// 客户端安全版:整树拷贝并删去 answer/explanation(硬约束 1 的服务端唯一出口;
// 与 lib/schema 的 stripAnswers 同语义,这里作用于带 id 的装配树)。有测试守卫。
export type ClientDbItem = Omit<DbItemRow, 'answer' | 'explanation'>
export type ClientAssembledPaper = Omit<AssembledPaper, 'sections'> & {
  sections: (Omit<AssembledSection, 'groups'> & { groups: (Omit<AssembledGroup, 'items'> & { items: ClientDbItem[] })[] })[]
}

export function stripAssembledAnswers(paper: AssembledPaper): ClientAssembledPaper {
  return {
    ...paper,
    sections: paper.sections.map((s) => ({
      ...s,
      groups: s.groups.map((g) => ({
        ...g,
        items: g.items.map((it) => {
          const rest: Record<string, unknown> = { ...it }
          delete rest.answer
          delete rest.explanation
          return rest as unknown as ClientDbItem
        }),
      })),
    })),
  }
}

// 会话用户 → users 行(attempts/responses 外键需要;开发登录与 Casdoor 共用)。
export async function ensureUser(db: Db, su: SessionUser): Promise<string> {
  const found = await db.query.users.findFirst({ where: eq(users.casdoorSub, su.sub) })
  if (found) return found.id
  const [row] = await db
    .insert(users)
    .values({ casdoorSub: su.sub, name: su.name, role: su.role })
    .onConflictDoNothing({ target: users.casdoorSub })
    .returning({ id: users.id })
  if (row) return row.id
  const again = await db.query.users.findFirst({ where: eq(users.casdoorSub, su.sub) })
  if (!again) throw new Error('用户建档失败')
  return again.id
}
