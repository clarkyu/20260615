/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory prisma mock */
import { describe, it, expect } from 'vitest'
import { sweepExpiredMedia } from '../retention'

type Sub = { id: number; createdAt: Date; videoKey: string | null; audioKey: string | null; imageKey: string | null }

function fake(subs: Sub[]): any {
  const store = subs.map((s) => ({ ...s }))
  return {
    _store: store,
    submission: {
      findMany: async ({ where, take }: any) => {
        const cutoff = where.createdAt.lt as Date
        return store
          .filter((s) => s.createdAt < cutoff && (s.videoKey || s.audioKey || s.imageKey))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, take)
          .map((s) => ({ id: s.id, videoKey: s.videoKey, audioKey: s.audioKey, imageKey: s.imageKey }))
      },
      update: async ({ where, data }: any) => {
        const s = store.find((x: Sub) => x.id === where.id)!
        Object.assign(s, data)
        return s
      },
    },
  }
}

const old = new Date('2026-01-01T00:00:00Z')
const recent = new Date('2026-06-18T00:00:00Z')
const cutoff = new Date('2026-03-01T00:00:00Z')

describe('sweepExpiredMedia', () => {
  it('deletes the media of expired rows + clears their keys, and leaves recent rows', async () => {
    const db = fake([
      { id: 1, createdAt: old, videoKey: 'v1', audioKey: 'a1', imageKey: null },
      { id: 2, createdAt: recent, videoKey: 'v2', audioKey: null, imageKey: null },
    ])
    const deleted: string[] = []
    const res = await sweepExpiredMedia(db, { cutoff, deleteObject: async (k) => { deleted.push(k) } })
    expect(res).toEqual({ scanned: 1, cleared: 1, errors: 0 })
    expect(deleted.sort()).toEqual(['a1', 'v1'])
    expect(db._store.find((s: Sub) => s.id === 1)).toMatchObject({ videoKey: null, audioKey: null, imageKey: null })
    expect(db._store.find((s: Sub) => s.id === 2)).toMatchObject({ videoKey: 'v2' }) // recent, untouched
  })

  it('keeps the keys when a delete fails, so the next run retries (no orphaned file)', async () => {
    const db = fake([{ id: 1, createdAt: old, videoKey: 'v1', audioKey: null, imageKey: null }])
    const res = await sweepExpiredMedia(db, { cutoff, deleteObject: async () => { throw new Error('R2 down') } })
    expect(res).toEqual({ scanned: 1, cleared: 0, errors: 1 })
    expect(db._store[0]).toMatchObject({ videoKey: 'v1' })
  })

  it('respects the batch limit', async () => {
    const db = fake([1, 2, 3].map((id) => ({ id, createdAt: old, videoKey: `v${id}`, audioKey: null, imageKey: null })))
    const res = await sweepExpiredMedia(db, { cutoff, deleteObject: async () => {}, limit: 2 })
    expect(res.scanned).toBe(2)
    expect(res.cleared).toBe(2)
  })
})
