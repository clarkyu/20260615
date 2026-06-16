import { describe, it, expect } from 'vitest'
import { parseForm, reqText, optText, checkbox, idList, intField, optId, z } from '@/lib/validate'

function fd(entries: [string, string][]): FormData {
  const f = new FormData()
  for (const [k, v] of entries) f.append(k, v)
  return f
}

const schema = z.object({
  name: reqText('err.needName', 50),
  note: optText(),
  pub: checkbox,
  ids: idList,
  n: intField(3),
})

describe('parseForm', () => {
  it('trims, coerces, collects repeated ids, applies defaults', () => {
    const r = parseForm(schema, fd([['name', '  Alice '], ['note', '   '], ['ids', '1'], ['ids', '2'], ['pub', 'on']]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toEqual({ name: 'Alice', note: null, pub: true, ids: [1, 2], n: 3 })
  })

  it('returns the i18n key of the first failing field', () => {
    expect(parseForm(schema, fd([['ids', '1']]))).toEqual({ ok: false, error: 'err.needName' })
  })

  it('rejects blank required text', () => {
    expect(parseForm(schema, fd([['name', '   ']]))).toEqual({ ok: false, error: 'err.needName' })
  })

  it('checkbox defaults to false when absent, single id coerces', () => {
    const r = parseForm(schema, fd([['name', 'x'], ['ids', '7'], ['n', '5']]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatchObject({ pub: false, ids: [7], n: 5 })
  })

  it('optId maps blank/absent to null and coerces a value', () => {
    const s = z.object({ dep: optId })
    expect(parseForm(s, fd([['dep', '']]))).toEqual({ ok: true, data: { dep: null } })
    expect(parseForm(s, fd([]))).toEqual({ ok: true, data: { dep: null } })
    const r = parseForm(s, fd([['dep', '4']]))
    expect(r.ok && r.data.dep).toBe(4)
  })
})
