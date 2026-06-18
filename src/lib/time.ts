// Local-day math for "due today" style windows. `tzo` is the browser's
// Date.getTimezoneOffset() (minutes; e.g. UTC+8 → -480), captured into a cookie so a
// UTC server can reason about the user's own calendar day. Pure — no Next imports.
export function localDayWindowUtc(now: Date, tzo: number): { start: Date; end: Date } {
  // Shift the instant so its UTC fields read as the user's local wall-clock.
  const local = new Date(now.getTime() - tzo * 60000)
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  const startMs = localMidnight + tzo * 60000 // convert that local midnight back to a UTC instant
  return { start: new Date(startMs), end: new Date(startMs + 86_400_000) }
}

// Parse the `tzo` cookie value defensively → minutes offset, default 0 (UTC).
export function parseTzOffset(raw: string | undefined | null): number {
  if (raw == null) return 0
  const n = Number(raw)
  return Number.isFinite(n) && Math.abs(n) <= 900 ? n : 0
}
