import { describe, it, expect, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'

// Smoke test for the integration harness itself: the 37 D1 migrations apply to a real
// SQLite engine and a real Prisma client can write + read them back.
describe('integration harness', () => {
  let db: TestDb
  afterEach(async () => { await db?.cleanup() })

  it('applies all migrations and round-trips a row through real Prisma', async () => {
    db = freshDb()
    const school = await db.prisma.school.create({ data: { name: 'Test School', code: 'TS1' } })
    expect(school.id).toBeGreaterThan(0)
    const found = await db.prisma.school.findUnique({ where: { id: school.id } })
    expect(found?.name).toBe('Test School')
  })
})
