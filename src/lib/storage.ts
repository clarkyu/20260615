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
