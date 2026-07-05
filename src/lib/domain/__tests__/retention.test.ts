/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory prisma mock */
import { describe, it, expect } from 'vitest'
import { sweepExpiredMedia } from '../retention'

type Sub = { id: number; createdAt: Date; videoKey: string | null; audioKey: string | null; imageKey: string | null }
type Take = { id: number; createdAt: Date; audioKey: string }
type Attempt = { id: number; createdAt: Date; mediaKey: string | null }

function fake(data: { subs?: Sub[]; takes?: Take[]; attempts?: Attempt[] } = {}): any {
  const subs = (data.subs ?? []).map((s) => ({ ...s }))
  const takes = (data.takes ?? []).map((t) => ({ ...t }))
  const attempts = (data.attempts ?? []).map((a) => ({ ...a }))
  const before = (where: any) => where.createdAt.lt as Date
  return {
    _subs: subs, _takes: takes, _attempts: attempts,
    submission: {
      findMany: async ({ where, take }: any) =>
        subs.filter((s) => s.createdAt < before(where) && (s.videoKey || s.audioKey || s.imageKey))
          .sort((a, b) => +a.createdAt - +b.createdAt).slice(0, take)
          .map((s) => ({ id: s.id, videoKey: s.videoKey, audioKey: s.audioKey, imageKey: s.imageKey })),
      update: async ({ where, data: d }: any) => { const s = subs.find((x: Sub) => x.id === where.id)!; Object.assign(s, d); return s },
    },
    shadowTake: {
      findMany: async ({ where, take }: any) =>
        takes.filter((t) => t.createdAt < before(where)).sort((a, b) => +a.createdAt - +b.createdAt).slice(0, take)
          .map((t) => ({ id: t.id, audioKey: t.audioKey })),
      delete: async ({ where }: any) => { takes.splice(takes.findIndex((t: Take) => t.id === where.id), 1); return {} },
    },
    practiceAttempt: {
      findMany: async ({ where, take }: any) =>
        attempts.filter((a) => a.createdAt < before(where) && a.mediaKey).sort((x, y) => +x.createdAt - +y.createdAt).slice(0, take)
          .map((a) => ({ id: a.id, mediaKey: a.mediaKey })),
      delete: async ({ where }: any) => { attempts.splice(attempts.findIndex((a: Attempt) => a.id === where.id), 1); return {} },
    },
  }
}

const old = new Date('2026-01-01T00:00:00Z')
const recent = new Date('2026-06-18T00:00:00Z')
const cutoff = new Date('2026-03-01T00:00:00Z')

describe('sweepExpiredMedia', () => {
  it('deletes the media of expired submissions + clears their keys, and leaves recent rows', async () => {
    const db = fake({ subs: [
      { id: 1, createdAt: old, videoKey: 'v1', audioKey: 'a1', imageKey: null },
      { id: 2, createdAt: recent, videoKey: 'v2', audioKey: null, imageKey: null },
    ] })
    const deleted: string[] = []
    const res = await sweepExpiredMedia(db, { cutoff, deleteObject: async (k) => { deleted.push(k) } })
    expect(res).toEqual({ scanned: 1, cleared: 1, errors: 0 })
    expect(deleted.sort()).toEqual(['a1', 'v1'])
    expect(db._subs.find((s: Sub) => s.id === 1)).toMatchObject({ videoKey: null, audioKey: null, imageKey: null })
    expect(db._subs.find((s: Sub) => s.id === 2)).toMatchObject({ videoKey: 'v2' }) // recent, untouched
  })

  it('keeps a submission key when its delete fails, so the next run retries (no orphan)', async () => {
    const db = fake({ subs: [{ id: 1, createdAt: old, videoKey: 'v1', audioKey: null, imageKey: null }] })
    const res = await sweepExpiredMedia(db, { cutoff, deleteObject: async () => { throw new Error('R2 down') } })
    expect(res).toEqual({ scanned: 1, cleared: 0, errors: 1 })
    expect(db._subs[0]).toMatchObject({ videoKey: 'v1' })
  })

  it('clears the keys whose object was deleted even when a sibling key persistently fails (audit P2-11)', async () => {
    // video deletes fine, audio is wedged: the good pointer must clear so it is never
    // re-attempted, while only the poison key stays to retry next run — no whole-row block.
    const db = fake({ subs: [{ id: 1, createdAt: old, videoKey: 'v1', audioKey: 'a-poison', imageKey: null }] })
    const deleted: string[] = []
    const res = await sweepExpiredMedia(db, { cutoff, deleteObject: async (k) => {
      if (k === 'a-poison') throw new Error('R2 wedged')
      deleted.push(k)
    } })
    expect(res).toEqual({ scanned: 1, cleared: 0, errors: 1 }) // row not fully cleared → counts as an error
    expect(deleted).toEqual(['v1']) // the good object was removed
    expect(db._subs[0]).toMatchObject({ videoKey: null, audioKey: 'a-poison' }) // good pointer cleared, poison retried
  })

  it('respects the batch limit', async () => {
    const db = fake({ subs: [1, 2, 3].map((id) => ({ id, createdAt: old, videoKey: `v${id}`, audioKey: null, imageKey: null })) })
    const res = await sweepExpiredMedia(db, { cutoff, deleteObject: async () => {}, limit: 2 })
    expect(res.scanned).toBe(2)
    expect(res.cleared).toBe(2)
  })

  it('deletes expired shadow takes (row + audio) and leaves recent ones', async () => {
    const db = fake({ takes: [
      { id: 10, createdAt: old, audioKey: 's-old' },
      { id: 11, createdAt: recent, audioKey: 's-recent' },
    ] })
    const deleted: string[] = []
    const res = await sweepExpiredMedia(db, { cutoff, deleteObject: async (k) => { deleted.push(k) } })
    expect(res).toEqual({ scanned: 1, cleared: 1, errors: 0 })
    expect(deleted).toEqual(['s-old'])
    expect(db._takes.map((t: Take) => t.id)).toEqual([11]) // old take row deleted
  })

  it('deletes expired practice recordings (row + media); skips media-less / recent attempts', async () => {
    const db = fake({ attempts: [
      { id: 20, createdAt: old, mediaKey: 'p-old' },
      { id: 21, createdAt: old, mediaKey: null }, // text-only practice — no media to sweep
      { id: 22, createdAt: recent, mediaKey: 'p-recent' },
    ] })
    const deleted: string[] = []
    const res = await sweepExpiredMedia(db, { cutoff, deleteObject: async (k) => { deleted.push(k) } })
    expect(res).toEqual({ scanned: 1, cleared: 1, errors: 0 })
    expect(deleted).toEqual(['p-old'])
    expect(db._attempts.map((a: Attempt) => a.id).sort()).toEqual([21, 22]) // only #20 deleted
  })

  it('sweeps all three media kinds in one run, with a combined tally', async () => {
    const db = fake({
      subs: [{ id: 1, createdAt: old, videoKey: 'v1', audioKey: null, imageKey: null }],
      takes: [{ id: 10, createdAt: old, audioKey: 's1' }],
      attempts: [{ id: 20, createdAt: old, mediaKey: 'p1' }],
    })
    const deleted: string[] = []
    const res = await sweepExpiredMedia(db, { cutoff, deleteObject: async (k) => { deleted.push(k) } })
    expect(res).toEqual({ scanned: 3, cleared: 3, errors: 0 })
    expect(deleted.sort()).toEqual(['p1', 's1', 'v1'])
  })
})
