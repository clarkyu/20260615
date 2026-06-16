import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

// Makes Cloudflare bindings (D1, R2, …) available during `next dev`.
initOpenNextCloudflareForDev()

/** @type {import("next").NextConfig} */

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The app records recitations, so camera/mic must be allowed for our own origin.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      // R2 (S3 API endpoint) serves uploaded images; browser uploads/plays media there too.
      "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com",
      "font-src 'self'",
      "connect-src 'self' https://*.r2.cloudflarestorage.com",
      "media-src 'self' blob: https://*.r2.cloudflarestorage.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
]

const config = {
  // Prisma client must not be bundled by Next; it's resolved at runtime.
  serverExternalPackages: ['@prisma/client', '.prisma/client'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

export default config
