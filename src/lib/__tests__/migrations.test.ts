import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Guard against drift between the two migration trees:
//  · d1/migrations/*.sql      — the production source of truth (wrangler applies it)
//  · prisma/migrations/*/      — the Prisma history mirror (prisma migrate dev)
// They must correspond 1:1 by logical name AND carry equivalent DDL, or production
// (which runs the d1 tree) and the Prisma Client (generated from the schema the prisma
// tree mirrors) silently disagree about the schema. CI runs this.

const ROOT = process.cwd()
const stripName = (s: string) => s.replace(/^\d+_/, '').replace(/\.sql$/, '')

const d1Files = readdirSync(join(ROOT, 'd1/migrations')).filter((f) => f.endsWith('.sql'))
const prismaDirs = readdirSync(join(ROOT, 'prisma/migrations'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)

const d1 = d1Files.map(stripName)
const prisma = prismaDirs.map(stripName)

// The executable DDL, ignoring cosmetics: strip `--` line comments, collapse whitespace,
// drop blank lines. Two bodies that normalize equal apply the same schema change.
const normalizeSql = (sql: string): string =>
  sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, '').replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n')

describe('migration trees correspond 1:1 (d1 ↔ prisma)', () => {
  it('have no duplicate logical names within a tree', () => {
    expect(new Set(d1).size).toBe(d1.length)
    expect(new Set(prisma).size).toBe(prisma.length)
  })

  it('contain the same set of migrations', () => {
    const onlyD1 = d1.filter((n) => !prisma.includes(n))
    const onlyPrisma = prisma.filter((n) => !d1.includes(n))
    expect({ onlyD1, onlyPrisma }).toEqual({ onlyD1: [], onlyPrisma: [] })
  })

  it('carry equivalent DDL per pair (normalized) — a hand-edit to one tree only would fail here', () => {
    const prismaByName = new Map(prismaDirs.map((d) => [stripName(d), d]))
    const mismatches: string[] = []
    for (const f of d1Files) {
      const dir = prismaByName.get(stripName(f))
      if (!dir) continue // pairing is asserted above; skip so this test reports only body drift
      const a = normalizeSql(readFileSync(join(ROOT, 'd1/migrations', f), 'utf8'))
      const b = normalizeSql(readFileSync(join(ROOT, 'prisma/migrations', dir, 'migration.sql'), 'utf8'))
      if (a !== b) mismatches.push(stripName(f))
    }
    expect(mismatches).toEqual([])
  })
})
