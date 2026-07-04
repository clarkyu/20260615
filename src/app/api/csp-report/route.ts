import { logWarn } from '@/lib/log'

// Collects violation reports from the strict Report-Only CSP (set in middleware). Logging
// the essentials lets us see what an ENFORCED strict policy would block — before flipping
// it on. Always answers 204: a report sink must never error back at the browser, and it
// never trusts the (attacker-influenceable) body beyond a few truncated fields.
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => null)) as { 'csp-report'?: Record<string, unknown> } | null
    const r = body?.['csp-report'] ?? (body as Record<string, unknown> | null)
    if (r) {
      logWarn('csp-report', 'CSP report-only violation', undefined, {
        directive: String(r['violated-directive'] ?? r['effective-directive'] ?? '').slice(0, 120),
        blocked: String(r['blocked-uri'] ?? '').slice(0, 200),
        document: String(r['document-uri'] ?? '').slice(0, 200),
      })
    }
  } catch {
    /* never throw back at the browser */
  }
  return new Response(null, { status: 204 })
}
