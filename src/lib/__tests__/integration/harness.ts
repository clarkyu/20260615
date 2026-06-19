import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@prisma/client'
import Database from 'better-sqlite3'
import { readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Integration-test harness: a REAL SQLite database (not a mock) with the actual D1
// migrations applied, fronted by a real Prisma client through the better-sqlite3
// driver adapter. This exercises the genuine SQL the repo/domain layers emit —
// catching multi-tenant scoping, IDOR, and relational behaviour that a mocked
// `prisma` can only approximate. Applying all 37 migrations also asserts they are
// valid against a real SQLite engine.

const MIGRATIONS_DIR = join(process.cwd(), 'd1', 'migrations')

export interface TestDb {
  prisma: PrismaClient
  cleanup: () => Promise<void>
}

export function freshDb(): TestDb {
  const file = join(tmpdir(), `itest-${process.pid}-${Math.random().toString(36).slice(2)}.db`)

  // Build the schema by replaying every D1 migration in order. FKs off during DDL so
  // the table-rebuild migrations (PRAGMA defer_foreign_keys) replay cleanly.
  const seed = new Database(file)
  seed.pragma('foreign_keys = OFF')
  const files = readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort()
  for (const f of files) seed.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  seed.close()

  const adapter = new PrismaBetterSqlite3({ url: `file:${file}` })
  const prisma = new PrismaClient({ adapter })

  return {
    prisma,
    cleanup: async () => {
      await prisma.$disconnect()
      try { unlinkSync(file) } catch { /* best effort */ }
    },
  }
}
