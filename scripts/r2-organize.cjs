// Reorganize R2-downloaded media into per-student folders, labelled with the
// student's 学号-姓名 (from D1). Zero dependencies — only Node built-ins.
//
// STEP 1 — download from R2 with rclone (preserves the key paths):
//   rclone copy r2:<R2_BUCKET>/submissions ./raw/submissions -P
//   rclone copy r2:<R2_BUCKET>/practice    ./raw/practice    -P   # optional
//
// STEP 2 — export the student map from D1 as students.json (id/studentNo/name):
//   wrangler d1 execute recitation-db --remote --json \
//     --command "SELECT id, studentNo, name FROM \"User\" WHERE role='STUDENT'" > students.json
//   (or copy the same query's result out of the D1 web console as JSON)
//
// STEP 3 — run:
//   node r2-organize.cjs ./raw ./organized ./students.json
//
// Output:
//   ./organized/<学号-姓名>/<submissions|practice>-作业<id>/<原文件名>
//   ./organized/manifest.csv   (谁、哪份作业、哪种、第几次/第几句、原 key、本地路径)

const fs = require('fs')
const path = require('path')

const RAW = process.argv[2] || './raw'
const OUT = process.argv[3] || './organized'
const MAP_FILE = process.argv[4] || './students.json'

// studentId -> "学号-姓名"
const byId = new Map()
if (fs.existsSync(MAP_FILE)) {
  let rows = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'))
  // Accept plain [...], wrangler's [{results:[...]}], or {results:[...]}.
  if (Array.isArray(rows) && rows[0] && rows[0].results) rows = rows[0].results
  else if (!Array.isArray(rows) && Array.isArray(rows.results)) rows = rows.results
  for (const r of rows) {
    const no = String(r.studentNo ?? '').trim()
    const nm = String(r.name ?? '').trim()
    byId.set(Number(r.id), [no, nm].filter(Boolean).join('-') || String(r.id))
  }
  console.log(`Loaded ${byId.size} students from ${MAP_FILE}`)
} else {
  console.log(`No ${MAP_FILE} found — folders will be named by student id.`)
}

const sanitize = (s) => s.replace(/[\\/:*?"<>|]/g, '_')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

if (!fs.existsSync(RAW)) { console.error(`Input folder "${RAW}" not found.`); process.exit(1) }
fs.mkdirSync(OUT, { recursive: true })

const manifest = [['studentId', '学号-姓名', 'kind', 'assignmentId', 'attempt', 'sentence', 'key', 'localPath']]
let copied = 0, skipped = 0

for (const src of walk(RAW)) {
  const rel = src.split(path.sep).join('/')
  const m = rel.match(/(submissions|practice)\/(\d+)\/(\d+)\/([^/]+)$/)
  if (!m) { skipped++; continue }
  const [, prefix, aid, sid, fname] = m
  const label = sanitize(byId.get(Number(sid)) || `student-${sid}`)

  let kind = '', attempt = '', sentence = '', mm
  if ((mm = fname.match(/^attempt-(\d+)-shadow-(\d+)\./))) { attempt = mm[1]; sentence = mm[2]; kind = 'shadow' }
  else if ((mm = fname.match(/^attempt-(\d+)-(video|audio|image)\./))) { attempt = mm[1]; kind = mm[2] }
  else if ((mm = fname.match(/^\d+-(audio|video)\./))) { kind = 'practice-' + mm[1] }

  const destDir = path.join(OUT, label, `${prefix}-作业${aid}`)
  fs.mkdirSync(destDir, { recursive: true })
  const dest = path.join(destDir, fname)
  fs.copyFileSync(src, dest)
  manifest.push([sid, label, kind, aid, attempt, sentence, `${prefix}/${aid}/${sid}/${fname}`, dest])
  copied++
}

// UTF-8 BOM so Excel opens the Chinese correctly.
const csv = '﻿' + manifest.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
fs.writeFileSync(path.join(OUT, 'manifest.csv'), csv)
console.log(`Done. Copied ${copied}, skipped ${skipped} (non-media). Index: ${path.join(OUT, 'manifest.csv')}`)
