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

// Format a UTC instant as YYYY-MM-DD in the timezone given by `tzo` (minutes from
// Date.getTimezoneOffset(); UTC+8 → -480). Deterministic from (iso, tzo) — the server
// and the browser produce the SAME string, so a date never flashes from UTC to local.
export function formatLocalDay(iso: string, tzo: number): string {
  // Shift the instant so its UTC fields read as the user's local wall-clock day.
  const d = new Date(new Date(iso).getTime() - tzo * 60000)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

// Like formatLocalDay but includes the wall-clock time: YYYY-MM-DD HH:mm in the timezone
// given by `tzo`. Deterministic from (iso, tzo). 原则：凡显示「时刻」（含时分）一律走这个，
// 跟随用户当地时间，绝不直接显示服务器 UTC。
export function formatLocalDateTime(iso: string, tzo: number): string {
  const d = new Date(new Date(iso).getTime() - tzo * 60000)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}
