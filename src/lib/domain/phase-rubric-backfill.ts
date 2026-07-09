import type { PrismaClient } from '@prisma/client'
import * as assignments from '@/lib/repo/assignments'

// 环节评分标准落地(维护,一次性):把某作业指定序号环节的 rubric(评分标准)+ referenceSource
// (参照来源:'prior-text' = 按本人前置写作环节文本评分)+ complianceScoring(背诵检测合规 ±10)
// 一次写到该 title 在本校所有班级的同序环节上。
//
// 数据无损铁律:**只写 Phase 的这三列,绝不碰 Submission / 已出评分**——已评的分不动;要让新标准
// 生效得另走重评(PR-3)。与其它维护端点同款:schoolId 必填钉租户;默认 dry-run 报当前值,apply 才写;
// 部分更新(只写明确给了的字段);幂等(set-to-value,重跑写同值)。

export interface SetPhaseRubricInput {
  rubric?: string
  referenceSource?: string | null
  complianceScoring?: boolean
  // 各维度分值的 JSON 字符串（[{"name","points"}]）——与 rubric 标准文字分开存。null = 清空（回退默认满分）。
  rubricPoints?: string | null
}

export type SetPhaseRubricReport =
  | {
      ok: true
      applied: boolean
      targets: number // 命中的环节数(= 该 title 的班级份数)
      perAssignment: {
        assignmentId: number
        itemType: string | null
        current: { rubric: string | null; referenceSource: string | null; complianceScoring: boolean }
      }[]
      updated: number
    }
  | { ok: false; error: string }

export async function setPhaseRubric(
  prisma: PrismaClient,
  schoolId: number,
  title: string,
  order: number,
  input: SetPhaseRubricInput,
  apply: boolean,
): Promise<SetPhaseRubricReport> {
  const rows = await assignments.findPhaseRubricTargets(prisma, schoolId, title, order)
  if (rows.length === 0) return { ok: false, error: 'no phase at this school+title+order' }
  const perAssignment = rows
    .map((r) => ({
      assignmentId: r.assignmentId,
      itemType: r.itemType,
      current: { rubric: r.rubric, referenceSource: r.referenceSource, complianceScoring: r.complianceScoring },
    }))
    .sort((a, b) => a.assignmentId - b.assignmentId)

  // 只把明确给了的字段放进更新集(部分更新)——省略某字段 = 不动它,避免误清历史配置。
  const data: { rubric?: string; referenceSource?: string | null; complianceScoring?: boolean; rubricPoints?: string | null } = {}
  if (typeof input.rubric === 'string') data.rubric = input.rubric
  if (input.referenceSource !== undefined) data.referenceSource = input.referenceSource
  if (typeof input.complianceScoring === 'boolean') data.complianceScoring = input.complianceScoring
  if (input.rubricPoints !== undefined) data.rubricPoints = input.rubricPoints
  if (Object.keys(data).length === 0) {
    return { ok: false, error: 'nothing to set: provide rubric / referenceSource / complianceScoring / rubricPoints' }
  }

  if (!apply) return { ok: true, applied: false, targets: rows.length, perAssignment, updated: 0 }
  const updated = await assignments.setPhaseRubricByIds(prisma, rows.map((r) => r.id), data)
  return { ok: true, applied: true, targets: rows.length, perAssignment, updated }
}
