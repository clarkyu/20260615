// 模板种子(维护):把代码内置的整卷题库(SEEDABLE_TEMPLATES,如 2025 湖北专升本真题)
// 写进 AssignmentTemplate,老师在「新建作业 → 选模板」里即可选用发布模拟考试。
// 与其它维护端点同款约定:默认 dry-run 报告(环节数/空数/权重合计),apply 才写;
// 幂等:同校同名模板已存在 → 更新 payload(题目勘误后重跑即生效),不存在 → 新建。

import type { PrismaClient } from '@prisma/client'
import * as templateRepo from '@/lib/repo/templates'
import { SEEDABLE_TEMPLATES } from '@/lib/data/exam-hubei-2025'
import { templatePayloadSchema } from '@/lib/assignment-template'
import { parseFillBlank, isGradableFillBlank, blankCount } from '@/lib/fill-blank'

export type SeedTemplateReport =
  | {
      ok: true
      applied: boolean
      key: string
      name: string
      action: 'create' | 'update'
      phases: number
      totalWeight: number
      fillBlankPhases: number
      totalBlanks: number
    }
  | { ok: false; error: string }

export async function seedAssignmentTemplate(prisma: PrismaClient, key: string, schoolId: number, apply: boolean): Promise<SeedTemplateReport> {
  const entry = SEEDABLE_TEMPLATES[key]
  if (!entry) return { ok: false, error: `unknown template key: ${key} (known: ${Object.keys(SEEDABLE_TEMPLATES).join(', ')})` }

  // 落库前再过一遍 schema + 填空可判分校验(测试也守着,这里是最后防线——
  // 坏答案键会让整班静默判 0,绝不能进库)。
  const parsed = templatePayloadSchema.safeParse(entry.payload)
  if (!parsed.success) return { ok: false, error: 'template payload failed schema validation' }
  let fillBlankPhases = 0
  let totalBlanks = 0
  for (const p of parsed.data.phases) {
    if (!p.fillBlank) continue
    fillBlankPhases++
    const fb = parseFillBlank(p.blanksJson)
    if (!isGradableFillBlank(fb)) return { ok: false, error: `phase "${p.title}" has an ungradable fill-blank key` }
    totalBlanks += blankCount(fb.text)
  }
  const totalWeight = parsed.data.phases.reduce((s, p) => s + p.weight, 0)

  const existing = await templateRepo.findByNameForSchool(prisma, schoolId, entry.name)
  const action: 'create' | 'update' = existing ? 'update' : 'create'
  const base = { ok: true as const, key, name: entry.name, action, phases: parsed.data.phases.length, totalWeight, fillBlankPhases, totalBlanks }
  if (!apply) return { ...base, applied: false }

  const payload = JSON.stringify(parsed.data)
  if (existing) await templateRepo.updatePayload(prisma, existing.id, payload)
  else await templateRepo.create(prisma, { schoolId, name: entry.name, createdById: null, payload })
  return { ...base, applied: true }
}
