// 把「作业」列表按发布批次归拢:一次"发一份 + 勾多个班"会给每班各建一份作业,列表里就是
// 多行同名作业。这里按 batchId(新作业)或 同名+同课程(老作业)归成一组,组内每个班一行,
// 并汇总提交/待批数。纯函数、可测。入参 list 需按新→旧排序(listForStaff 已 createdAt desc),
// 组的先后即沿用之(每组取首见=最新的那份的展示字段)。

import { compareClassName } from '@/lib/class-sort'

export interface BatchAssignmentRow {
  id: number
  title: string
  category: string | null
  mode: string | null // 作业性质四态(HOMEWORK/TRAINING/ASSESSMENT/EXAM),null = 未定
  dueAt: Date | null
  batchId: string | null
  phaseCount: number
  courseId: number
  courseName: string
  className: string
}

export interface BatchGroup {
  key: string
  title: string
  category: string | null
  mode: string | null
  courseId: number
  courseName: string
  dueAt: Date | null
  phaseCount: number
  classes: { assignmentId: number; className: string; submitted: number; pending: number }[]
  totalSubmitted: number
  totalPending: number
}

// 组键:batchId 精确(同一次发布);老作业无 batchId → 同课程 + 同标题 视为一批。
export function batchKeyOf(a: { batchId: string | null; courseId: number; title: string }): string {
  return a.batchId ? `batch:${a.batchId}` : `legacy:${a.courseId}:${a.title}`
}

// 列表截断防劈批(复查 R12):列表有界后,截断点可能落在一个批次中间——批次卡缺班,
// 批次改名/归并还会只写可见的那一半。取 cap+1 行喂进来:若确有越界,把可见区尾部与
// 越界首行同组的行一并裁掉,保证 batchId 批次(同次发布、行相邻)要么整组可见、要么
// 整组不见。无 batchId 的 legacy 同名组行可能不相邻,仍有跨界残余(风险仅限「改名只
// 改可见部分」,不损数据)——「归并批次」正把存量组收敛成 batchId 批次。
export function trimBoundaryBatch<T extends { batchId: string | null; courseId: number; title: string }>(
  fetched: T[],
  cap: number,
): { rows: T[]; truncated: boolean } {
  if (fetched.length <= cap) return { rows: fetched, truncated: false }
  const rows = fetched.slice(0, cap)
  const extraKey = batchKeyOf(fetched[cap])
  while (rows.length > 0 && batchKeyOf(rows[rows.length - 1]) === extraKey) rows.pop()
  return { rows, truncated: true }
}

export function groupAssignmentBatches(
  list: BatchAssignmentRow[],
  submitted: Map<number, number>,
  pending: Map<number, number>,
): BatchGroup[] {
  const groups = new Map<string, BatchGroup>()
  const order: string[] = []
  for (const a of list) {
    const key = batchKeyOf(a)
    let g = groups.get(key)
    if (!g) {
      g = { key, title: a.title, category: a.category, mode: a.mode, courseId: a.courseId, courseName: a.courseName, dueAt: a.dueAt, phaseCount: a.phaseCount, classes: [], totalSubmitted: 0, totalPending: 0 }
      groups.set(key, g)
      order.push(key)
    }
    const sub = submitted.get(a.id) ?? 0
    const pend = pending.get(a.id) ?? 0
    g.classes.push({ assignmentId: a.id, className: a.className, submitted: sub, pending: pend })
    g.totalSubmitted += sub
    g.totalPending += pend
  }
  // 批次内班级按班级序号升序(全站口径)——入参是 createdAt desc,组内到达序 = 建作业序,
  // 与班号无关;作业列表/看板/归并页共用这份分组,在源头排一次。
  for (const g of groups.values()) g.classes.sort((x, y) => compareClassName(x.className, y.className))
  return order.map((k) => groups.get(k)!)
}
