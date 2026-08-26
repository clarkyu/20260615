import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { getDb } from '../src/lib/db/client'

async function main() {
  await migrate(getDb(), { migrationsFolder: 'drizzle' })
  console.log('迁移完成')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
