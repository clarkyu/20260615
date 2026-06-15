export async function getAppUrl(): Promise<string> {
  const url = process.env.APP_URL
  if (!url) throw new Error('APP_URL environment variable is required')
  return url.replace(/\/$/, '')
}

// Only allow same-site relative redirects; reject absolute or protocol-relative
// URLs so a crafted `next` parameter cannot bounce users off-site.
export function getSafeRedirectPath(value: FormDataEntryValue | string | null): string {
  const path = String(value ?? '').trim()
  if (!path.startsWith('/') || path.startsWith('//')) return '/'
  return path
}
