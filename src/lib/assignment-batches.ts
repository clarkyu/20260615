// 把「作业」列表按发布批次归拢:一次"发一份 + 勾多个班"会给每班各建一份作业,列表里就是
// 多行同名作业。这里按 batchId(新作业)或 同名+同课程(老作业)归成一组,组内每个班一行,
// 并汇总提交/待批数。纯函数、可测。入参 list 需按新→旧排序(listForStaff 已 createdAt desc),
// 组的先后即沿用之(每组取首见=最新的那份的展示字段)。

export interface BatchAssignmentRow {
  id: number
  title: string
  category: string | null
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
  courseId: number
  courseName: string
  dueAt: Date | null
  phaseCount: number
  classes: { assignmentId: number; className: string; submitted: number; pending: number }[]
  totalSubmitted: number
  totalPending: number
}

export function groupAssignmentBatches(
  list: BatchAssignmentRow[],
  submitted: Map<number, number>,
  pending: Map<number, number>,
): BatchGroup[] {
  const groups = new Map<string, BatchGroup>()
  const order: string[] = []
  for (const a of list) {
    // batchId 精确(同一次发布);老作业无 batchId → 同课程 + 同标题 视为一批。
    const key = a.batchId ? `batch:${a.batchId}` : `legacy:${a.courseId}:${a.title}`
    let g = groups.get(key)
    if (!g) {
      g = { key, title: a.title, category: a.category, courseId: a.courseId, courseName: a.courseName, dueAt: a.dueAt, phaseCount: a.phaseCount, classes: [], totalSubmitted: 0, totalPending: 0 }
      groups.set(key, g)
      order.push(key)
    }
    const sub = submitted.get(a.id) ?? 0
    const pend = pending.get(a.id) ?? 0
    g.classes.push({ assignmentId: a.id, className: a.className, submitted: sub, pending: pend })
    g.totalSubmitted += sub
    g.totalPending += pend
  }
  return order.map((k) => groups.get(k)!)
}
