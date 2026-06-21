// E2E seed: provision a local (miniflare) D1 with a school + one teacher + one student
// so the browser login flow has real accounts to sign in as. Runs BEFORE Playwright
// starts `next dev` (no DB lock contention). Idempotent via INSERT OR REPLACE.
//
// Password hashing mirrors src/lib/password.ts (PBKDF2-SHA-256, 100k iters, 16B salt,
// 256-bit, stored as `pbkdf2$<iter>$<saltB64>$<hashB64>`) so verifyPassword accepts it.
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const E2E_PASSWORD = 'e2e-pass-123'

const b64 = (u) => { let s = ''; for (const b of u) s += String.fromCharCode(b); return btoa(s) }
async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256))
  return `pbkdf2$100000$${b64(salt)}$${b64(bits)}`
}

const hash = await hashPassword(E2E_PASSWORD)
const TS = '2026-06-01T00:00:00.000+00:00'
const sql = [
  `INSERT OR REPLACE INTO School (id,name,code,createdAt) VALUES (1,'E2E 测试学校','E2E','${TS}');`,
  `INSERT OR REPLACE INTO User (id,role,schoolId,staffNo,name,passwordHash,isActive,mustChangePassword,createdAt,updatedAt) VALUES (1,'TEACHER',1,'T1','王老师','${hash}',1,0,'${TS}','${TS}');`,
  `INSERT OR REPLACE INTO User (id,role,schoolId,studentNo,name,passwordHash,isActive,mustChangePassword,createdAt,updatedAt) VALUES (2,'STUDENT',1,'2025001','张三','${hash}',1,0,'${TS}','${TS}');`,
  `INSERT OR REPLACE INTO ClassGroup (id,schoolId,name,createdAt) VALUES (1,1,'一班','${TS}');`,
  `INSERT OR REPLACE INTO StudentClass (id,studentId,classId) VALUES (1,2,1);`,
].join('\n')

const sqlFile = join(here, '.seed.sql')
writeFileSync(sqlFile, sql)
console.log('[e2e seed] applying local D1 migrations…')
execSync('npx wrangler d1 migrations apply recitation-db --local', { cwd: join(here, '..'), stdio: 'inherit' })
console.log('[e2e seed] seeding school + teacher(T1) + student(2025001), password = ' + E2E_PASSWORD)
execSync(`npx wrangler d1 execute recitation-db --local --file=${JSON.stringify(sqlFile)}`, { cwd: join(here, '..'), stdio: 'inherit' })
console.log('[e2e seed] done')
