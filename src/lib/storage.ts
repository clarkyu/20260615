import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Cloudflare R2 is S3-compatible. Configure via env:
//   R2_ENDPOINT          e.g. https://<accountid>.r2.cloudflarestorage.com
//   R2_ACCESS_KEY_ID
//   R2_SECRET_ACCESS_KEY
//   R2_BUCKET
// When unset, the app still runs; upload/playback simply report "not configured".

export function storageConfigured(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  )
}

let cached: S3Client | null = null

function client(): S3Client {
  if (cached) return cached
  cached = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
  return cached
}

function bucket(): string {
  const b = process.env.R2_BUCKET
  if (!b) throw new Error('R2_BUCKET is not configured')
  return b
}

// A single presigned PUT handles files up to 5 GB, so 200 MB videos upload in
// one request. (Multipart/resumable upload can be layered on later for very
// flaky mobile networks.)
export async function presignUpload(key: string, contentType: string, expiresIn = 3600): Promise<string> {
  const cmd = new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType })
  return getSignedUrl(client(), cmd, { expiresIn })
}

export async function presignDownload(key: string, expiresIn = 3600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket(), Key: key })
  return getSignedUrl(client(), cmd, { expiresIn })
}

// Deterministic, collision-resistant object keys.
export function submissionVideoKey(assignmentId: number, studentId: number, attempt: number, ext: string): string {
  return `submissions/${assignmentId}/${studentId}/attempt-${attempt}.${ext}`
}

export function referenceAudioKey(assignmentId: number, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `reference/${assignmentId}/${Date.now()}-${safe}`
}
