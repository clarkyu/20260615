// All-in-one R2 export: list + download + organize, in one Node script.
// Zero dependencies (Node 18+ only — uses global fetch + node:crypto).
//
// SETUP — set four env vars (from Cloudflare → R2 → Manage R2 API Tokens):
//   export R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
//   export R2_BUCKET=<your-bucket>
//   export R2_ACCESS_KEY_ID=<key>
//   export R2_SECRET_ACCESS_KEY=<secret>
//
// (optional) student map so folders are named 学号-姓名 instead of by id:
//   wrangler d1 execute recitation-db --remote --json \
//     --command "SELECT id, studentNo, name FROM \"User\" WHERE role='STUDENT'" > students.json
//   (or run that SELECT in the D1 web console and save the JSON as students.json)
//
// RUN:
//   node r2-export.mjs                       # → ./organized, prefixes submissions,practice
//   node r2-export.mjs ./out ./students.json submissions,practice,bank
//
// OUTPUT:
//   <out>/<学号-姓名>/<submissions|practice>-作业<id>/<原文件名>
//   <out>/_other/<key>           (anything not matching the student pattern, e.g. bank/)
//   <out>/manifest.csv

import { createHash, createHmac } from 'node:crypto'
import { writeFile, mkdir, readFile, access } from 'node:fs/promises'
import path from 'node:path'

const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env
for (const [k, v] of Object.entries({ R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY })) {
  if (!v) { console.error(`Missing env var ${k}.`); process.exit(1) }
}
const OUT = process.argv[2] || './organized'
const MAP_FILE = process.argv[3] || './students.json'
const PREFIXES = (process.argv[4] || 'submissions,practice').split(',').map((s) => s.trim()).filter(Boolean)

const REGION = 'auto', SERVICE = 's3'
const HOST = new URL(R2_ENDPOINT).host
const BASE = R2_ENDPOINT.replace(/\/$/, '')
const EMPTY_HASH = createHash('sha256').update('').digest('hex')
const sha256hex = (d) => createHash('sha256').update(d).digest('hex')
const hmac = (key, d) => createHmac('sha256', key).update(d).digest()

// RFC3986 encoding used by AWS SigV4. encodeSlash=false keeps '/' literal (paths).
function enc(s, encodeSlash = true) {
  let out = ''
  for (const b of Buffer.from(String(s), 'utf8')) {
    const c = String.fromCharCode(b)
    if (/[A-Za-z0-9\-_.~]/.test(c)) out += c
    else if (c === '/' && !encodeSlash) out += c
    else out += '%' + b.toString(16).toUpperCase().padStart(2, '0')
  }
  return out
}
const encKeyPath = (key) => key.split('/').map((s) => enc(s)).join('/')
const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

// Returns SigV4 headers for an unsigned-body GET. `query` is sorted+encoded.
function sign(canonicalUri, query) {
  const amzdate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '') // YYYYMMDDTHHMMSSZ
  const datestamp = amzdate.slice(0, 8)
  const qs = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&')
  const canonHeaders = `host:${HOST}\nx-amz-content-sha256:${EMPTY_HASH}\nx-amz-date:${amzdate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonReq = ['GET', canonicalUri, qs, canonHeaders, signedHeaders, EMPTY_HASH].join('\n')
  const scope = `${datestamp}/${REGION}/${SERVICE}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzdate, scope, sha256hex(canonReq)].join('\n')
  let k = hmac('AWS4' + R2_SECRET_ACCESS_KEY, datestamp)
  k = hmac(k, REGION); k = hmac(k, SERVICE); k = hmac(k, 'aws4_request')
  const sig = createHmac('sha256', k).update(toSign).digest('hex')
  return {
    Authorization: `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`,
    'x-amz-content-sha256': EMPTY_HASH,
    'x-amz-date': amzdate,
  }
}

async function listAll(prefix) {
  const keys = []
  let token
  do {
    const query = { 'list-type': '2', prefix }
    if (token) query['continuation-token'] = token
    const headers = sign(`/${enc(R2_BUCKET)}`, query)
    const qs = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&')
    const res = await fetch(`${BASE}/${enc(R2_BUCKET)}?${qs}`, { headers })
    if (!res.ok) throw new Error(`List "${prefix}" → ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const xml = await res.text()
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(decodeXml(m[1]))
    const t = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)
    token = t ? decodeXml(t[1]) : undefined
  } while (token)
  return keys
}

async function download(key, dest) {
  const headers = sign(`/${enc(R2_BUCKET)}/${encKeyPath(key)}`, {})
  const res = await fetch(`${BASE}/${enc(R2_BUCKET)}/${encKeyPath(key)}`, { headers })
  if (!res.ok) throw new Error(`Get "${key}" → ${res.status}`)
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
}

const exists = (p) => access(p).then(() => true, () => false)
const sanitize = (s) => s.replace(/[\\/:*?"<>|]/g, '_')

// Load student map.
const byId = new Map()
if (await exists(MAP_FILE)) {
  let rows = JSON.parse(await readFile(MAP_FILE, 'utf8'))
  if (Array.isArray(rows) && rows[0] && rows[0].results) rows = rows[0].results
  else if (!Array.isArray(rows) && Array.isArray(rows.results)) rows = rows.results
  for (const r of rows) {
    const label = [String(r.studentNo ?? '').trim(), String(r.name ?? '').trim()].filter(Boolean).join('-')
    byId.set(Number(r.id), label || String(r.id))
  }
  console.log(`Loaded ${byId.size} students from ${MAP_FILE}.`)
} else {
  console.log(`No ${MAP_FILE} — folders named by student id.`)
}

const manifest = [['studentId', '学号-姓名', 'kind', 'assignmentId', 'attempt', 'sentence', 'key', 'localPath']]
let done = 0, skip = 0
for (const prefix of PREFIXES) {
  const keys = await listAll(prefix.replace(/\/?$/, '/'))
  console.log(`${prefix}/ : ${keys.length} objects`)
  for (const key of keys) {
    const m = key.match(/^(submissions|practice)\/(\d+)\/(\d+)\/([^/]+)$/)
    let dest, row
    if (m) {
      const [, pfx, aid, sid, fname] = m
      const label = sanitize(byId.get(Number(sid)) || `student-${sid}`)
      let kind = '', attempt = '', sentence = '', mm
      if ((mm = fname.match(/^attempt-(\d+)-shadow-(\d+)\./))) { attempt = mm[1]; sentence = mm[2]; kind = 'shadow' }
      else if ((mm = fname.match(/^attempt-(\d+)-(video|audio|image)\./))) { attempt = mm[1]; kind = mm[2] }
      else if ((mm = fname.match(/^\d+-(audio|video)\./))) { kind = 'practice-' + mm[1] }
      dest = path.join(OUT, label, `${pfx}-作业${aid}`, fname)
      row = [sid, label, kind, aid, attempt, sentence, key, dest]
    } else {
      dest = path.join(OUT, '_other', ...key.split('/'))
      row = ['', '', 'other', '', '', '', key, dest]
    }
    if (await exists(dest)) { skip++ } else { await download(key, dest); done++ }
    manifest.push(row)
    if ((done + skip) % 50 === 0) console.log(`  …${done} downloaded, ${skip} already present`)
  }
}

const csv = '﻿' + manifest.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
await mkdir(OUT, { recursive: true })
await writeFile(path.join(OUT, 'manifest.csv'), csv)
console.log(`Done. Downloaded ${done}, skipped ${skip} (already present). Index: ${path.join(OUT, 'manifest.csv')}`)
