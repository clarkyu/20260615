import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { paperSchema, stripAnswers } from '@/lib/schema/paper'

const seedPath = join(__dirname, '..', '..', 'seed', 'paper-2025-hubei-english.json')
const seed = JSON.parse(readFileSync(seedPath, 'utf-8'))

describe('paperSchema(种子即第一份验收数据)', () => {
  it('种子文件整体通过校验,结构计数为 6 大题 / 8 题组 / 43 小题 / 总分 100', () => {
    const parsed = paperSchema.safeParse(seed)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const p = parsed.data
    expect(p.sections).toHaveLength(6)
    expect(p.sections.flatMap((s) => s.groups)).toHaveLength(8)
    const items = p.sections.flatMap((s) => s.groups.flatMap((g) => g.items))
    expect(items).toHaveLength(43)
    expect(items.reduce((sum, it) => sum + it.score, 0)).toBe(100)
    expect(p.totalScore).toBe(100)
    // 题号连续且唯一(1..43)。
    expect([...new Set(items.map((it) => it.number))].sort((a, b) => a - b)).toEqual(Array.from({ length: 43 }, (_, i) => i + 1))
  })

  it('删改任意关键字段能报出准确错误(以 answer.accepted 为例)', () => {
    const broken = structuredClone(seed)
    delete broken.sections[0].groups[0].items[0].answer.accepted
    const parsed = paperSchema.safeParse(broken)
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const paths = parsed.error.issues.map((i) => i.path.join('.'))
    expect(paths.some((p) => p.includes('answer'))).toBe(true)
  })

  it('占位符与小题对应:每个含 {{n}} 的 frame,其 n 都能在本组小题题号中找到', () => {
    const p = paperSchema.parse(seed)
    for (const s of p.sections) {
      for (const g of s.groups) {
        const numbers = new Set(g.items.map((it) => String(it.number)))
        for (const m of (g.frame ?? '').matchAll(/\{\{(\w+)\}\}/g)) {
          expect(numbers.has(m[1] ?? '')).toBe(true)
        }
      }
    }
  })
})

describe('stripAnswers(硬约束 1:答案永不下发)', () => {
  it('剥离后任何小题都不含 answer 与 explanation,其余字段保留', () => {
    const p = paperSchema.parse(seed)
    const client = stripAnswers(p)
    const clientItems = client.sections.flatMap((s) => s.groups.flatMap((g) => g.items))
    expect(clientItems).toHaveLength(43)
    for (const it of clientItems) {
      expect('answer' in it).toBe(false)
      expect('explanation' in it).toBe(false)
      expect(it.number).toBeGreaterThan(0)
    }
    // 序列化整卷后不出现任何参考答案文本(抽查作文范文与第 1 题答案)。
    const json = JSON.stringify(client)
    expect(json.includes('biggest')).toBe(false)
    // 原对象未被修改。
    expect(p.sections[0]?.groups[0]?.items[0] && 'answer' in p.sections[0].groups[0].items[0]).toBe(true)
  })
})
