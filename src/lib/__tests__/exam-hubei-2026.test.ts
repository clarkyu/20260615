import { describe, it, expect } from 'vitest'
import { EXAM_HUBEI_2026, SEEDABLE_TEMPLATES_2026 } from '@/lib/data/exam-hubei-2026'
import { SEEDABLE_TEMPLATES } from '@/lib/data/exam-templates'
import { templatePayloadSchema } from '@/lib/assignment-template'
import { parseFillBlank, isGradableFillBlank, blankCount, gradeFillBlank } from '@/lib/fill-blank'

// 2026 真题模板的结构守卫(与 2025 同款):答案键坏了会让整班静默判 0,把「可判分」钉死在 CI。

describe('2026 湖北专升本真题模板', () => {
  it('payload 通过模板 schema 校验', () => {
    expect(templatePayloadSchema.safeParse(EXAM_HUBEI_2026).success).toBe(true)
  })

  it('权重合计恰为试卷总分 100(各环节 = 各大题分值)', () => {
    expect(EXAM_HUBEI_2026.phases.map((p) => p.weight)).toEqual([20, 12, 10, 10, 10, 10, 18, 10])
    expect(EXAM_HUBEI_2026.phases.reduce((s, p) => s + p.weight, 0)).toBe(100)
  })

  it('每个填空环节:空数与答案键一致且可判分(20+10+10+18 共四个环节)', () => {
    const fb = EXAM_HUBEI_2026.phases.filter((p) => p.fillBlank)
    expect(fb.map((p) => p.weight)).toEqual([20, 10, 10, 18])
    for (const p of fb) {
      const parsed = parseFillBlank(p.blanksJson)
      expect(isGradableFillBlank(parsed)).toBe(true)
      expect(blankCount(parsed.text)).toBe(parsed.accept.length)
    }
    // 空数分布:短文填空 10、阅读填词 5+5、汉译英 6。
    expect(fb.map((p) => parseFillBlank(p.blanksJson).accept.length)).toEqual([10, 5, 5, 6])
  })

  it('汉译英每个答案不超过两个词(题面规则)', () => {
    const tr = EXAM_HUBEI_2026.phases.find((p) => p.weight === 18)!
    for (const alts of parseFillBlank(tr.blanksJson).accept) {
      for (const a of alts) expect(a.trim().split(/\s+/).length).toBeLessThanOrEqual(2)
    }
  })

  it('阅读填词的每个答案都能在对应文章正文中找到(补写句必须支撑空位)', () => {
    const [p1, p2] = EXAM_HUBEI_2026.phases.filter((p) => p.fillBlank && p.weight === 10)
    for (const p of [p1, p2]) {
      const passage = p.instructions.toLowerCase()
      for (const alts of parseFillBlank(p.blanksJson).accept) {
        expect(passage).toContain(alts[0].toLowerCase())
      }
    }
  })

  it('主观环节都有 rubric,且 rubricPoints 之和 = 该大题分值(12/10/10/10)', () => {
    const ft = EXAM_HUBEI_2026.phases.filter((p) => p.requireFreeText)
    expect(ft.map((p) => p.weight)).toEqual([12, 10, 10, 10])
    for (const p of ft) {
      expect((p.rubric ?? '').length).toBeGreaterThan(20)
      const sum = p.rubricPoints.reduce((s, r) => s + r.points, 0)
      expect(sum).toBe(p.weight)
    }
  })

  it('答案键判分自洽:标准答案满分,大小写/多空格不敏感', () => {
    for (const p of EXAM_HUBEI_2026.phases.filter((x) => x.fillBlank)) {
      const { accept } = parseFillBlank(p.blanksJson)
      const perfect = accept.map((a) => a[0].toUpperCase() + ' ')
      expect(gradeFillBlank(perfect, accept)).toEqual({ correct: accept.length, total: accept.length })
      // 每个备选答案也都判对(如 favouring / that)。
      for (let i = 0; i < accept.length; i++) {
        for (const alt of accept[i]) {
          const answers = accept.map((a, j) => (j === i ? alt : a[0]))
          expect(gradeFillBlank(answers, accept).correct).toBe(accept.length)
        }
      }
    }
  })

  it('本卷条目:整卷 + 6 张题型分卷,全部属「专升本英语」系列;分卷可重做 3 次、整卷 1 次', () => {
    const keys = Object.keys(SEEDABLE_TEMPLATES_2026)
    expect(keys).toHaveLength(7)
    expect(SEEDABLE_TEMPLATES_2026['exam-hubei-2026'].name).toBe(EXAM_HUBEI_2026.title)
    for (const key of keys) {
      const entry = SEEDABLE_TEMPLATES_2026[key]
      expect(entry.series).toBe('专升本英语')
      expect(templatePayloadSchema.safeParse(entry.payload).success).toBe(true)
      expect(entry.name).toBe(entry.payload.title)
      const expectAttempts = key === 'exam-hubei-2026' ? 1 : 3
      for (const ph of entry.payload.phases) expect(ph.maxAttempts).toBe(expectAttempts)
    }
    expect(
      ['hubei-2026-cloze', 'hubei-2026-reorder', 'hubei-2026-reading-fill', 'hubei-2026-reading-qa', 'hubei-2026-translate', 'hubei-2026-essay']
        .map((k) => SEEDABLE_TEMPLATES_2026[k].payload.phases.length),
    ).toEqual([1, 1, 2, 2, 1, 1])
  })

  it('题库页摘要:8 环节/满分 100/客观 4/AI 判 4/录制 0', async () => {
    const { summarizeTemplatePayload } = await import('@/lib/assignment-template')
    expect(summarizeTemplatePayload(EXAM_HUBEI_2026)).toEqual({ phases: 8, totalWeight: 100, objectivePhases: 4, aiJudgedPhases: 4, mediaPhases: 0 })
  })
})

describe('全站模板注册表(exam-templates)', () => {
  it('汇总 2025 + 2026 共 14 个条目,key 与模板名全站唯一', () => {
    const keys = Object.keys(SEEDABLE_TEMPLATES)
    expect(keys).toHaveLength(14)
    expect(keys.filter((k) => k.includes('2025'))).toHaveLength(7)
    expect(keys.filter((k) => k.includes('2026'))).toHaveLength(7)
    const names = keys.map((k) => SEEDABLE_TEMPLATES[k].name)
    expect(new Set(names).size).toBe(names.length) // 同校同名幂等更新,重名会互相覆盖
    for (const k of keys) expect(SEEDABLE_TEMPLATES[k].series).toBe('专升本英语')
  })
})
