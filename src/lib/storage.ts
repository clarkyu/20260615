import { AwsClient } from 'aws4fetch'
import { config } from '@/lib/config'

// Cloudflare R2 (S3-compatible). Phones upload directly via presigned URLs.
// Credentials (R2_*) come from the centralised config. aws4fetch is used instead
// of the AWS SDK because it's tiny and runs on Workers.

export { storageConfigured } from '@/lib/config'

function client(): AwsClient {
  const r = config.r2()
  return new AwsClient({
    accessKeyId: r.accessKeyId!,
    secretAccessKey: r.secretAccessKey!,
    service: 's3',
    region: 'auto',
  })
}

function objectUrl(key: string): string {
  const r = config.r2()
  const base = r.endpoint!.replace(/\/$/, '')
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  return `${base}/${r.bucket}/${encodedKey}`
}

// SigV4 query-signed URL (signed query, not headers) so the browser can PUT/GET
// directly with any content-type. A single PUT handles files up to 5 GB.
async function presign(key: string, method: 'PUT' | 'GET', expiresIn: number): Promise<string> {
  const url = `${objectUrl(key)}?X-Amz-Expires=${expiresIn}`
  const signed = await client().sign(new Request(url, { method }), { aws: { signQuery: true } })
  return signed.url
}

export async function presignUpload(key: string, _contentType: string, expiresIn = 3600): Promise<string> {
  return presign(key, 'PUT', expiresIn)
}

export async function presignDownload(key: string, expiresIn = 3600): Promise<string> {
  return presign(key, 'GET', expiresIn)
}

// ── R2 multipart(S3 兼容)——长视频分片上传 ────────────────────────────────────────
// 单发整段 PUT 在弱网下必挂且只能整段重来(学生「长视频提交不成功」的根因之一)。
// 分片:服务端建会话/逐片预签名,浏览器逐片 PUT(每片可独立重试);完成时服务端
// ListParts 收集 ETag 再 Complete——不依赖浏览器读 ETag 响应头(免 R2 CORS expose 配置)。

const xmlField = (xml: string, tag: string): string[] => {
  const out: string[] = []
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g')
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1])
  return out
}

// 纯函数导出便于单测:从 S3 XML 里解析。
export function parseUploadId(xml: string): string | null {
  return xmlField(xml, 'UploadId')[0] ?? null
}
export function parseListedParts(xml: string): { partNumber: number; etag: string }[] {
  const nums = xmlField(xml, 'PartNumber')
  const tags = xmlField(xml, 'ETag')
  return nums
    .map((n, i) => ({ partNumber: Number(n), etag: (tags[i] ?? '').replace(/&quot;/g, '"') }))
    .filter((p) => Number.isInteger(p.partNumber) && p.partNumber > 0 && p.etag)
    .sort((a, b) => a.partNumber - b.partNumber)
}

export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  const res = await client().fetch(`${objectUrl(key)}?uploads`, { method: 'POST', headers: { 'Content-Type': contentType } })
  if (!res.ok) throw new Error(`R2 create multipart failed: ${res.status}`)
  const id = parseUploadId(await res.text())
  if (!id) throw new Error('R2 create multipart: no UploadId in response')
  return id
}

export async function presignUploadPart(key: string, uploadId: string, partNumber: number, expiresIn = 3600): Promise<string> {
  const url = `${objectUrl(key)}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}&X-Amz-Expires=${expiresIn}`
  const signed = await client().sign(new Request(url, { method: 'PUT' }), { aws: { signQuery: true } })
  return signed.url
}

export async function completeMultipartUpload(key: string, uploadId: string): Promise<void> {
  const base = `${objectUrl(key)}?uploadId=${encodeURIComponent(uploadId)}`
  const list = await client().fetch(base, { method: 'GET' })
  if (!list.ok) throw new Error(`R2 list parts failed: ${list.status}`)
  const parts = parseListedParts(await list.text())
  if (parts.length === 0) throw new Error('R2 complete multipart: no parts uploaded')
  const body =
    '<CompleteMultipartUpload>' +
    parts.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag.replace(/"/g, '&quot;')}</ETag></Part>`).join('') +
    '</CompleteMultipartUpload>'
  const res = await client().fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body })
  if (!res.ok) throw new Error(`R2 complete multipart failed: ${res.status}`)
  // S3 兼容层可能在 200 响应体里报错(体内 <Error>)——按失败处理,避免假成功。
  const text = await res.text()
  if (text.includes('<Error>')) throw new Error('R2 complete multipart returned error body')
}

// 清理未完成的分片会话(失败/放弃时 best-effort;404 = 已清)。
export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  const res = await client().fetch(`${objectUrl(key)}?uploadId=${encodeURIComponent(uploadId)}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new Error(`R2 abort multipart failed: ${res.status}`)
}

// Delete one object. Best-effort: an already-gone object (404) counts as success.
export async function deleteObject(key: string): Promise<void> {
  const res = await client().fetch(objectUrl(key), { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed: ${res.status}`)
}

// 对象健康探测(服务端签名请求,只取 1 字节):'ok' 在且非空;'empty' 在但 0 字节
// (bytes=0-0 对空对象 → 416);'missing' 不存在(404);'unknown' 其它(网络/5xx)——
// 调用方应把 unknown 当「暂时无法判断」放行,别把偶发故障当缺失。
export type ObjectHealth = 'ok' | 'empty' | 'missing' | 'unknown'
export async function probeObject(key: string): Promise<ObjectHealth> {
  try {
    const res = await client().fetch(objectUrl(key), { headers: { range: 'bytes=0-0' } })
    try { await res.body?.cancel() } catch { /* 已消费/已关闭 */ }
    if (res.ok) return 'ok'
    if (res.status === 416) return 'empty'
    if (res.status === 404) return 'missing'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

// Media keys carry the phaseId so the per-phase submissions of one assignment never
// collide on the same attempt number. (A single-phase assignment still has exactly
// one phase, so this is just an extra path segment.)
export function submissionMediaKey(assignmentId: number, phaseId: number, studentId: number, attempt: number, kind: 'video' | 'audio' | 'image', ext: string): string {
  return `submissions/${assignmentId}/${phaseId}/${studentId}/attempt-${attempt}-${kind}.${ext}`
}

// One per-sentence shadowing take.
export function shadowTakeKey(assignmentId: number, phaseId: number, studentId: number, attempt: number, order: number, ext: string): string {
  return `submissions/${assignmentId}/${phaseId}/${studentId}/attempt-${attempt}-shadow-${order}.${ext}`
}

// Practice recordings live under their own prefix and are timestamped, since a
// student may practice many times before a formal submission.
export function practiceMediaKey(assignmentId: number, phaseId: number, studentId: number, kind: 'audio' | 'video', ext: string): string {
  return `practice/${assignmentId}/${phaseId}/${studentId}/${Date.now()}-${kind}.${ext}`
}

// The single shadowing video for an item-bank chunk set.
export function chunkSetVideoKey(chunkSetId: number, ext: string): string {
  return `bank/${chunkSetId}/shadow-${Date.now()}.${ext}`
}

export function referenceAudioKey(assignmentId: number, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `reference/${assignmentId}/${Date.now()}-${safe}`
}
