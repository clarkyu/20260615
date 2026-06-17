// Rename the export's "student-<id>" folders to "学号-姓名" using names from D1.
// No re-download — just renames the folders you already have.
//
// SETUP — one Cloudflare API token with D1 read:
//   Cloudflare → 右上头像 → My Profile → API Tokens → Create Token →
//   Create Custom Token → Permissions: Account · D1 · Read → 选你的账号 → 创建、复制
//
// RUN (PowerShell):
//   $env:CF_API_TOKEN="<刚建的token>"
//   node r2-relabel.mjs ./organized
//
// (账号/库 id 已内置为本项目的；如需覆盖：$env:CF_ACCOUNT_ID / $env:D1_DATABASE_ID)

import { readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const TOKEN = process.env.CF_API_TOKEN
const ACCT = process.env.CF_ACCOUNT_ID || 'cdf2cd6abae90fc7733ecd7335b50e99'
const DB = process.env.D1_DATABASE_ID || '32a87766-2835-448c-a56e-44a08b598c3e'
const DIR = process.argv[2] || './organized'
if (!TOKEN) { console.error('请先设置 $env:CF_API_TOKEN（一个有 D1 读权限的 Cloudflare 令牌）。'); process.exit(1) }

const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB}/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ sql: 'SELECT id, studentNo, name FROM "User" WHERE role = \'STUDENT\'' }),
})
const json = await res.json().catch(() => ({}))
if (!res.ok || !json.success) {
  console.error(`D1 查询失败（HTTP ${res.status}）：`, JSON.stringify(json.errors || json).slice(0, 400))
  process.exit(1)
}
const rows = json.result?.[0]?.results || []
const sanitize = (s) => s.replace(/[\\/:*?"<>|]/g, '_')
const byId = new Map(
  rows.map((r) => [Number(r.id), sanitize([String(r.studentNo ?? '').trim(), String(r.name ?? '').trim()].filter(Boolean).join('-') || String(r.id))]),
)
console.log(`从 D1 取到 ${byId.size} 个学生。`)
await writeFile('students.json', JSON.stringify(rows), 'utf8') // 留一份，备用

let renamed = 0, skipped = 0
for (const e of await readdir(DIR, { withFileTypes: true })) {
  if (!e.isDirectory()) continue
  const m = e.name.match(/^student-(\d+)$/)
  if (!m) { skipped++; continue }
  const label = byId.get(Number(m[1]))
  if (!label || label === e.name) { skipped++; continue }
  try {
    await rename(path.join(DIR, e.name), path.join(DIR, label))
    renamed++
  } catch (err) {
    console.warn(`  跳过 ${e.name} → ${label}（${err.code}，目标可能已存在）`)
    skipped++
  }
}
console.log(`完成：重命名 ${renamed} 个文件夹，跳过 ${skipped}。（students.json 已保存。）`)
