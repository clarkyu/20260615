import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

// 进程级单例连接池;DATABASE_URL 缺失时在首次使用处抛错(构建期不连库)。
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb() {
  if (_db) return _db
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL 未配置')
  _db = drizzle(new Pool({ connectionString: url }), { schema })
  return _db
}

export type Db = ReturnType<typeof getDb>
