import { AwsClient } from 'aws4fetch'

// Cloudflare R2 (S3-compatible). Phones upload directly via presigned URLs.
// Configure: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
// aws4fetch is used instead of the AWS SDK because it's tiny and runs on Workers.

export function storageConfigured(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  )
}

function client(): AwsClient {
  return new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    service: 's3',
    region: 'auto',
  })
}

function objectUrl(key: string): string {
  const base = process.env.R2_ENDPOINT!.replace(/\/$/, '')
  const bucket = process.env.R2_BUCKET!
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  return `${base}/${bucket}/${encodedKey}`
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
