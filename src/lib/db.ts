import { getCloudflareContext } from '@opennextjs/cloudflare'
import { PrismaClient } from '@prisma/client'
import { PrismaD1 } from '@prisma/adapter-d1'

// On Cloudflare the database is the D1 binding, only available inside the
// request context — so the client is created per request (and memoised per
// isolate keyed by the binding) rather than as a module-level singleton.
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
