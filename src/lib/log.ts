// Structured logging for the Workers runtime. One JSON line per event so Cloudflare's
// log pipeline (`wrangler tail` / Logpush) can filter by `level` and `scope` instead of
// grepping free text — and so an Error's stack actually survives (plain
// `JSON.stringify(err)` emits `{}`, because Error's fields are non-enumerable; the Workers
// tail would otherwise show the message but lose the trace).
//
// SECURITY: only ever logs the message + an error's name/message/stack + the literal
// `fields` the caller passes. Never hand it a request body, headers, a password, or any
// secret VALUE — config logs presence, never values (see lib/config.ts). Keep `fields`
// to safe scalars (ids, counts, flags), the same discipline as the rest of the codebase.

type Level = 'error' | 'warn' | 'info'

// Safe scalar fields only — no nested objects that might smuggle a secret.
export type LogFields = Record<string, string | number | boolean | null | undefined>

// Reduce an unknown thrown value to structured, JSON-safe fields. Errors keep their
// stack (the whole point); anything else degrades to a string.
function describeError(err: unknown): { name?: string; message: string; stack?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack }
  if (typeof err === 'string') return { message: err }
  try {
    return { message: JSON.stringify(err) ?? String(err) }
  } catch {
    return { message: String(err) }
  }
}

function emit(level: Level, scope: string, msg: string, err: unknown, fields: LogFields | undefined) {
  const event: Record<string, unknown> = { level, scope, msg, ts: new Date().toISOString() }
  if (fields) for (const [k, v] of Object.entries(fields)) if (v !== undefined) event[k] = v
  if (err !== undefined) event.err = describeError(err)
  const line = JSON.stringify(event)
  // Keep the console.* level so existing log-level routing/alerting still works.
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.info(line)
}

export const logError = (scope: string, msg: string, err?: unknown, fields?: LogFields) =>
  emit('error', scope, msg, err, fields)
export const logWarn = (scope: string, msg: string, err?: unknown, fields?: LogFields) =>
  emit('warn', scope, msg, err, fields)
export const logInfo = (scope: string, msg: string, fields?: LogFields) =>
  emit('info', scope, msg, undefined, fields)
