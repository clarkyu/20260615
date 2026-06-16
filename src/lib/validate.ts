import { z } from 'zod'

// A single trusted boundary for server-action input. Actions parse FormData with a
// schema here instead of ad-hoc `formData.get(...).trim()` checks. Field messages
// are i18n keys; on failure the first issue's message is returned for the action
// to translate, keeping the existing `{ error: i18nKey }` convention.

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string }

export function parseForm<S extends z.ZodType>(schema: S, formData: FormData): ParseResult<z.infer<S>> {
  const obj: Record<string, unknown> = {}
  for (const key of new Set(formData.keys())) {
    const all = formData.getAll(key)
    obj[key] = all.length > 1 ? all : all[0]
  }
  const res = schema.safeParse(obj)
  if (res.success) return { ok: true, data: res.data }
  return { ok: false, error: res.error.issues[0]?.message || 'err.invalidInput' }
}

// ── Field builders (validation messages are i18n keys) ───────────────────────

// Required, non-empty, length-bounded text (trimmed).
export const reqText = (msg: string, max = 500) =>
  z
    .string({ error: msg })
    .transform((s) => s.trim())
    .refine((s) => s.length > 0 && s.length <= max, { error: msg })

// Optional text → trimmed string, or null when absent/blank/too long.
export const optText = (max = 20000) =>
  z
    .string()
    .optional()
    .transform((v) => {
      const t = (v ?? '').trim()
      return t.length > 0 && t.length <= max ? t : null
    })

// A checkbox: present in the form payload ⇒ true.
export const checkbox = z.preprocess((v) => v !== undefined, z.boolean())

// A positive-int id (e.g. a hidden field). Tampered/missing ⇒ validation fails.
export const reqId = z.coerce.number().int().positive()

// A repeated id field (0, 1, or many) → array of positive ints.
export const idList = z.preprocess(
  (v) => (Array.isArray(v) ? v : v != null ? [v] : []),
  z.array(z.coerce.number().int().positive()),
)

// Bounded integer with a default when absent/blank.
export const intField = (def: number, min = 1, max = 9999) =>
  z.preprocess((v) => (v === undefined || v === '' ? def : v), z.coerce.number().int().min(min).max(max))

export { z }
