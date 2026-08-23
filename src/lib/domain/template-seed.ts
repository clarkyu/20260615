// 模板种子(维护):把代码内置的整卷题库(SEEDABLE_TEMPLATES,如 2025 湖北专升本真题
// 整卷 + 各题型分卷)写进 AssignmentTemplate,老师在「题库 → 笔试试卷」或「新建作业 →
// 选模板」里选用发布。与其它维护端点同款约定:默认 dry-run 报告,apply 才写;幂等:
// 同校同名已存在 → 更新 payload/series(题目勘误后重跑即生效),不存在 → 新建。
// key='all' 一次种全套(逐 key 报告)。

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
      series: string | null
      action: 'create' | 'update'
      phases: number
      totalWeight: number
      fillBlankPhases: number
      totalBlanks: number
    }
  | { ok: false; key: string; error: string }

export async function seedAssignmentTemplate(prisma: PrismaClient, key: string, schoolId: number, apply: boolean): Promise<SeedTemplateReport> {
  const entry = SEEDABLE_TEMPLATES[key]
  if (!entry) return { ok: false, key, error: `unknown template key: ${key} (known: all, ${Object.keys(SEEDABLE_TEMPLATES).join(', ')})` }

  // 落库前再过一遍 schema + 填空可判分校验(测试也守着,这里是最后防线——
  // 坏答案键会让整班静默判 0,绝不能进库)。
  const parsed = templatePayloadSchema.safeParse(entry.payload)
  if (!parsed.success) return { ok: false, key, error: 'template payload failed schema validation' }
  let fillBlankPhases = 0
  let totalBlanks = 0
  for (const p of parsed.data.phases) {
    if (!p.fillBlank) continue
    fillBlankPhases++
    const fb = parseFillBlank(p.blanksJson)
    if (!isGradableFillBlank(fb)) return { ok: false, key, error: `phase "${p.title}" has an ungradable fill-blank key` }
    totalBlanks += blankCount(fb.text)
  }
  const totalWeight = parsed.data.phases.reduce((s, p) => s + p.weight, 0)

  const existing = await templateRepo.findByNameForSchool(prisma, schoolId, entry.name)
  const action: 'create' | 'update' = existing ? 'update' : 'create'
  const base = { ok: true as const, key, name: entry.name, series: entry.series, action, phases: parsed.data.phases.length, totalWeight, fillBlankPhases, totalBlanks }
  if (!apply) return { ...base, applied: false }

  const payload = JSON.stringify(parsed.data)
  if (existing) await templateRepo.updateSeeded(prisma, existing.id, payload, entry.series)
  else await templateRepo.create(prisma, { schoolId, name: entry.name, series: entry.series, createdById: null, payload })
  return { ...base, applied: true }
}

// key='all':按注册表顺序全量种(单 key 失败不拦后续,逐 key 报告)。
export async function seedAssignmentTemplates(prisma: PrismaClient, key: string, schoolId: number, apply: boolean): Promise<SeedTemplateReport[]> {
  const keys = key === 'all' ? Object.keys(SEEDABLE_TEMPLATES) : [key]
  const reports: SeedTemplateReport[] = []
  for (const k of keys) reports.push(await seedAssignmentTemplate(prisma, k, schoolId, apply))
  return reports
}
