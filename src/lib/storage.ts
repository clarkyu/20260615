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

export function submissionMediaKey(assignmentId: number, studentId: number, attempt: number, kind: 'video' | 'audio' | 'image', ext: string): string {
  return `submissions/${assignmentId}/${studentId}/attempt-${attempt}-${kind}.${ext}`
}

// One per-sentence shadowing take.
export function shadowTakeKey(assignmentId: number, studentId: number, attempt: number, order: number, ext: string): string {
  return `submissions/${assignmentId}/${studentId}/attempt-${attempt}-shadow-${order}.${ext}`
}

// Practice recordings live under their own prefix and are timestamped, since a
// student may practice many times before a formal submission.
export function practiceMediaKey(assignmentId: number, studentId: number, kind: 'audio' | 'video', ext: string): string {
  return `practice/${assignmentId}/${studentId}/${Date.now()}-${kind}.${ext}`
}

// The single shadowing video for an item-bank chunk set.
export function chunkSetVideoKey(chunkSetId: number, ext: string): string {
  return `bank/${chunkSetId}/shadow-${Date.now()}.${ext}`
}

export function referenceAudioKey(assignmentId: number, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `reference/${assignmentId}/${Date.now()}-${safe}`
}
