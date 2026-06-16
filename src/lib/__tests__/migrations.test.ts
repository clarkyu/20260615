import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

// Guard against drift between the two migration trees:
//  · d1/migrations/*.sql      — the production source of truth (wrangler applies it)
//  · prisma/migrations/*/      — the Prisma history mirror (prisma migrate dev)
// They must correspond 1:1 by logical name, or `prisma migrate` and production
// disagree about schema state. CI runs this; a missing/extra migration fails here.

const ROOT = process.cwd()
const stripName = (s: string) => s.replace(/^\d+_/, '').replace(/\.sql$/, '')

const d1 = readdirSync(join(ROOT, 'd1/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map(stripName)

const prisma = readdirSync(join(ROOT, 'prisma/migrations'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => stripName(e.name))

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
})
