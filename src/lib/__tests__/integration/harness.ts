import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@prisma/client'
import Database from 'better-sqlite3'
import { readFileSync, readdirSync, unlinkSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Integration-test harness: a REAL SQLite database (not a mock) with the actual D1
// migrations applied, fronted by a real Prisma client through the better-sqlite3
// driver adapter. This exercises the genuine SQL the repo/domain layers emit —
// catching multi-tenant scoping, IDOR, and relational behaviour that a mocked
// `prisma` can only approximate. Replaying every migration also asserts they are
// valid against a real SQLite engine.

const MIGRATIONS_DIR = join(process.cwd(), 'd1', 'migrations')

export interface TestDb {
  prisma: PrismaClient
  cleanup: () => Promise<void>
}

// The migrated schema is built ONCE per worker process into a template file, then each
// `freshDb()` clones that file. Replaying all migrations grows O(migrations) and used to
// run in every `beforeEach` — as the migration count climbed it began blowing past
// vitest's default 10s hook timeout under parallel CI load (flaky "Hook timed out").
// A file copy is ~O(1), so per-test setup is now near-instant; the one-time replay still
// asserts every migration is valid against a real SQLite engine.
let templatePath: string | null = null

function migratedTemplate(): string {
  if (templatePath) return templatePath
  const file = join(tmpdir(), `itest-template-${process.pid}.db`)
  // FKs off during DDL so the table-rebuild migrations (PRAGMA defer_foreign_keys) replay cleanly.
  const seed = new Database(file)
  seed.pragma('foreign_keys = OFF')
  const files = readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort()
  for (const f of files) seed.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  seed.close() // no open transaction / default (non-WAL) journal → the file is fully self-contained to copy
  templatePath = file
  return file
}

export function freshDb(): TestDb {
  const file = join(tmpdir(), `itest-${process.pid}-${Math.random().toString(36).slice(2)}.db`)
  copyFileSync(migratedTemplate(), file) // clone the migrated schema instead of re-replaying migrations

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
