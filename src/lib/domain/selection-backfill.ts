import type { PrismaClient } from '@prisma/client'
import * as assignments from '@/lib/repo/assignments'

// 选题落地(维护,一次性):把某作业指定序号的「纯选择环节」从历史「投票 hack」正式标成选题
// (theme·主题 / branch·分流),或标回 poll·民调(mode=null 亦即民调)。
//
// 数据无损铁律:**只写 Phase.selectionMode,绝不碰 Submission**——学生已选的题目(recitedText)、
// 已交的下游作业、已出的评分,全部原样保留。也不动 branchTopicsJson(不追溯给历史作业设分流门,
// 免得「该做 vs 已做」打架);要分流的下游归属由老师在发布端另配。
//
// 与其它维护端点同款约定:schoolId 必填钉租户;默认 dry-run 报当前状态,apply 才写;幂等
// (set-to-value,重跑写同值);可逆(标回 poll/null 即回到民调)。

export type SetSelectionModeReport =
  | {
      ok: true
      applied: boolean
      targets: number // 命中的环节数(= 该 title 的班级份数)
      perAssignment: { assignmentId: number; current: string | null }[] // 各份当前 mode,供核对
      updated: number
    }
  | { ok: false; error: string }

export async function setSelectionMode(
  prisma: PrismaClient,
  schoolId: number,
  title: string,
  order: number,
  mode: 'poll' | 'theme' | 'branch' | null,
  apply: boolean,
): Promise<SetSelectionModeReport> {
  const rows = await assignments.findSelectionModeTargets(prisma, schoolId, title, order)
  if (rows.length === 0) return { ok: false, error: 'no pure-choice phase at this school+title+order (需 requireChoice 且无答案键)' }
  const perAssignment = rows
    .map((r) => ({ assignmentId: r.assignmentId, current: r.selectionMode }))
    .sort((a, b) => a.assignmentId - b.assignmentId)
  if (!apply) return { ok: true, applied: false, targets: rows.length, perAssignment, updated: 0 }
  // 'poll' 与 null 同义(历史纯投票);统一落 null,保持列的「缺省=民调」语义干净。
  const updated = await assignments.setPhaseSelectionModeByIds(prisma, rows.map((r) => r.id), mode === 'poll' ? null : mode)
  return { ok: true, applied: true, targets: rows.length, perAssignment, updated }
}
