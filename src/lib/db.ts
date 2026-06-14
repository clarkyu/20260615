import Database from 'better-sqlite3'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

function createPrismaClient() {
  const url = (process.env.DATABASE_URL ?? 'file:./dev.db').replace(/^file:/, '')
  // Set file-level pragmas using a temporary connection — journal_mode and
  // synchronous persist to the SQLite file itself.
  const setup = new Database(url)
  setup.pragma('journal_mode = WAL')
  setup.pragma('synchronous = NORMAL')
  // Wait instead of failing immediately if another writer (e.g. a grading
  // worker) holds the lock.
  setup.pragma('busy_timeout = 5000')
  setup.close()
  const adapter = new PrismaBetterSqlite3({ url })
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
  })
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
