import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// createdAt 时间戳格式不变量（审计 ②b —— 加守卫、不整表重建）。
//
// 每个 createdAt 列在 D1 里都是 `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`。SQLite 的
// CURRENT_TIMESTAMP 产出 "YYYY-MM-DD HH:MM:SS"（空格分隔、无毫秒无时区），与 Prisma
// `@default(now())` 由客户端写入的 ISO 8601（"…THH:MM:SS.sssZ"）字面不同。但这个 DB 默认值
// 在本应用里**从不触发**：每一次建行都走 Prisma，由客户端显式供值。所以库里 createdAt 始终
// 是统一的 ISO 值——为一个永不触发的默认值重建约 20 张表，风险高、收益近零（clark 拍板：守卫替代重建）。
//
// 让上面这句「从不触发」成立的唯一前提：**建行永远经过 Prisma**，绝不用 raw SQL `INSERT INTO`
// 去写一个带 createdAt 的表却不给 createdAt（那样 DB 默认值就会触发、写出异格式时间戳）。本守卫
// 把这个前提钉死：今后谁加了这样的 raw INSERT，测试立刻红，逼他显式供 createdAt 或改走 Prisma。

const ROOT = process.cwd()

// D1 表名 = Prisma model 名。收集所有带 createdAt 列的 model。
function createdAtTables(): Set<string> {
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
  const out = new Set<string>()
  const modelRe = /model\s+(\w+)\s*\{([^}]*)\}/g // model 体内无嵌套花括号，[^}]* 够用
  let m: RegExpExecArray | null
  while ((m = modelRe.exec(schema))) if (/\bcreatedAt\b/.test(m[2])) out.add(m[1])
  return out
}

// 所有 src 下的 .ts/.tsx，跳过测试目录（测试里出现 "INSERT INTO" 字面不算违规）。
function srcFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (e.name !== '__tests__') out.push(...srcFiles(join(dir, e.name))); continue }
    if (/\.tsx?$/.test(e.name)) out.push(join(dir, e.name))
  }
  return out
}

describe('createdAt format invariant (audit ②b — guard instead of table rebuild)', () => {
  it('parses the createdAt-bearing models from the schema (sanity)', () => {
    const t = createdAtTables()
    expect(t.has('School')).toBe(true)
    expect(t.has('SchoolInvite')).toBe(true)
    expect(t.has('Submission')).toBe(true)
  })

  it('no raw `INSERT INTO` a createdAt table in src — creation goes through Prisma, so DEFAULT CURRENT_TIMESTAMP never fires', () => {
    const tables = createdAtTables()
    const offenders: string[] = []
    const insertRe = /INSERT\s+INTO\s+"?(\w+)"?/gi
    for (const file of srcFiles(join(ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8')
      let m: RegExpExecArray | null
      while ((m = insertRe.exec(text))) {
        const table = m[1]
        if (!tables.has(table)) continue // e.g. RateLimit has no createdAt — the default concern doesn't apply
        // Escape hatch: a raw insert that explicitly supplies createdAt (in ISO) is fine.
        const window = text.slice(m.index, m.index + 400)
        if (!/createdAt/i.test(window)) offenders.push(`${file.replace(ROOT + '/', '')} → INSERT INTO ${table}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
