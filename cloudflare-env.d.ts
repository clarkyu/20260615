/// <reference types="@cloudflare/workers-types" />

// Cloudflare bindings available at runtime via getCloudflareContext().env.
// Scalar vars/secrets (SESSION_SECRET, R2_*, RESEND_API_KEY, AI keys, APP_URL…)
// are surfaced on process.env by the OpenNext adapter and accessed there.
interface CloudflareEnv {
  DB: D1Database
  BUCKET: R2Bucket
  ASSETS: Fetcher
}
