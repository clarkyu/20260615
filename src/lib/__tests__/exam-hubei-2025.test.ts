import { describe, it, expect } from 'vitest'
import { EXAM_HUBEI_2025, SEEDABLE_TEMPLATES } from '@/lib/data/exam-hubei-2025'
import { templatePayloadSchema } from '@/lib/assignment-template'
import { parseFillBlank, isGradableFillBlank, blankCount, gradeFillBlank } from '@/lib/fill-blank'

// 整卷题库的结构守卫:答案键坏了会让整班静默判 0,这里把「可判分」钉死在 CI。

describe('2025 湖北专升本真题模板', () => {
  it('payload 通过模板 schema 校验', () => {
    expect(templatePayloadSchema.safeParse(EXAM_HUBEI_2025).success).toBe(true)
  })

  it('权重合计恰为试卷总分 100(各环节 = 各大题分值)', () => {
    expect(EXAM_HUBEI_2025.phases.reduce((s, p) => s + p.weight, 0)).toBe(100)
  })

  it('每个填空环节:空数与答案键一致且可判分(20+10+10+18 共四个环节)', () => {
    const fb = EXAM_HUBEI_2025.phases.filter((p) => p.fillBlank)
    expect(fb.map((p) => p.weight)).toEqual([20, 10, 10, 18])
    for (const p of fb) {
      const parsed = parseFillBlank(p.blanksJson)
      expect(isGradableFillBlank(parsed)).toBe(true)
      expect(blankCount(parsed.text)).toBe(parsed.accept.length)
    }
    // 空数分布:短文填空 10、阅读填词 5+5、汉译英 6。
    expect(fb.map((p) => parseFillBlank(p.blanksJson).accept.length)).toEqual([10, 5, 5, 6])
  })

  it('主观环节都有 rubric,且 rubricPoints 之和 = 该大题分值(12/10/10/10)', () => {
    const ft = EXAM_HUBEI_2025.phases.filter((p) => p.requireFreeText)
    expect(ft).toHaveLength(4)
    for (const p of ft) {
      expect((p.rubric ?? '').length).toBeGreaterThan(20)
      const sum = p.rubricPoints.reduce((s, r) => s + r.points, 0)
      expect(sum).toBe(p.weight)
    }
  })

  it('答案键判分自洽:标准答案满分,大小写/多空格不敏感', () => {
    for (const p of EXAM_HUBEI_2025.phases.filter((x) => x.fillBlank)) {
      const { accept } = parseFillBlank(p.blanksJson)
      const perfect = accept.map((a) => a[0].toUpperCase() + ' ') // 全大写 + 尾随空格仍应全对
      expect(gradeFillBlank(perfect, accept)).toEqual({ correct: accept.length, total: accept.length })
    }
  })

  it('注册表含本卷,名称与 payload 标题一致', () => {
    const entry = SEEDABLE_TEMPLATES['exam-hubei-2025']
    expect(entry).toBeDefined()
    expect(entry.name).toBe(EXAM_HUBEI_2025.title)
  })

  it('注册表全量守卫:整卷+6 张题型分卷,全部属「专升本英语」系列且可判分', () => {
    const keys = Object.keys(SEEDABLE_TEMPLATES)
    expect(keys).toHaveLength(7)
    for (const key of keys) {
      const entry = SEEDABLE_TEMPLATES[key]
      expect(entry.series).toBe('专升本英语')
      expect(templatePayloadSchema.safeParse(entry.payload).success).toBe(true)
      expect(entry.name).toBe(entry.payload.title)
      for (const ph of entry.payload.phases.filter((x) => x.fillBlank)) {
        const fb = parseFillBlank(ph.blanksJson)
        expect(isGradableFillBlank(fb)).toBe(true)
        expect(blankCount(fb.text)).toBe(fb.accept.length)
      }
      // 题型分卷是训练卷:可重做 3 次;整卷维持考试口径 1 次。
      const expectAttempts = key === 'exam-hubei-2025' ? 1 : 3
      for (const ph of entry.payload.phases) expect(ph.maxAttempts).toBe(expectAttempts)
    }
    // 分卷环节数:短文填空1/连词成句1/阅读填词2/阅读问答2/汉译英1/作文1。
    expect(
      ['hubei-2025-cloze', 'hubei-2025-reorder', 'hubei-2025-reading-fill', 'hubei-2025-reading-qa', 'hubei-2025-translate', 'hubei-2025-essay']
        .map((k) => SEEDABLE_TEMPLATES[k].payload.phases.length),
    ).toEqual([1, 1, 2, 2, 1, 1])
  })
})

describe('summarizeTemplatePayload(题库页试卷摘要)', () => {
  it('对真题模板:8 环节/满分 100/客观 4/AI 判 4/录制 0', async () => {
    const { summarizeTemplatePayload } = await import('@/lib/assignment-template')
    const s = summarizeTemplatePayload(EXAM_HUBEI_2025)
    expect(s).toEqual({ phases: 8, totalWeight: 100, objectivePhases: 4, aiJudgedPhases: 4, mediaPhases: 0 })
  })
})
