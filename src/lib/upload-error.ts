// After a deploy, a stale client bundle calls a server action the new server no
// longer recognizes — Next throws `UnrecognizedActionError` (or a message about a
// missing "Server Action"). It is NOT a network failure, so show "refresh the
// page" instead of "check your connection".

type T = (key: string, vars?: Record<string, string | number>) => string

export function isStaleAction(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  return e.name === 'UnrecognizedActionError' || /server action/i.test(e.message)
}

// The message to show when a direct upload (presign action + PUT) fails.
export function uploadErrorText(e: unknown, t: T): string {
  if (isStaleAction(e)) return t('rec.staleReload')
  return `${t('rec.uploadFail')} · ${e instanceof Error ? e.name : 'network'}`
}
