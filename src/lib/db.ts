import { getCloudflareContext } from '@opennextjs/cloudflare'
import { PrismaClient } from '@prisma/client'
import { PrismaD1 } from '@prisma/adapter-d1'

// On Cloudflare the database is the D1 binding, only available inside the
// request context — so the client is created per request (and memoised per
// isolate keyed by the binding) rather than as a module-level singleton.
//
// CASCADE INTEGRITY DEPENDS ON D1. The schema uses relationMode = "foreignKeys"
// (Prisma delegates onDelete Cascade/SetNull to the DB, no app-level emulation), and
// D1 enforces foreign keys by default — so deleting e.g. a School correctly cascades
// to its users/classes/offerings/assignments/submissions. This binding must stay a D1
// database: pointing it at a plain SQLite/libSQL endpoint that defaults foreign_keys
// OFF would silently turn every cascade into a no-op and orphan rows with no error.
// The integration tests run `PRAGMA foreign_keys = ON` precisely to mirror D1's default.
const clients = new WeakMap<object, PrismaClient>()

export async function getDb(): Promise<PrismaClient> {
  const { env } = await getCloudflareContext({ async: true })
  const binding = env.DB as unknown as object
  const existing = clients.get(binding)
  if (existing) return existing
  const client = new PrismaClient({ adapter: new PrismaD1(env.DB) })
  clients.set(binding, client)
  return client
}
