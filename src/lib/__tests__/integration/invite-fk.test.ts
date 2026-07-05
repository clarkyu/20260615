import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import * as inviteRepo from '@/lib/repo/invites'

// SchoolInvite.createdById now carries a real FK (nullable + ON DELETE SET NULL) — audit ②a.
// Before, it was a bare Int: deleting the admin who created an invite left a dangling
// reference and no referential integrity. Run against real SQL (FKs ON) so the FK is
// actually enforced, matching D1 (foreignKeys relation mode, no emulation).

describe('SchoolInvite.createdById FK (audit ②a)', () => {
  let db: TestDb
  beforeEach(async () => { db = freshDb(); await db.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON') })
  afterEach(async () => { await db?.cleanup() })

  it('deleting the creator NULLs createdById (SET NULL) — the invite survives, no dangling ref', async () => {
    const p = db.prisma
    const school = await p.school.create({ data: { name: 'S', code: 'S' } })
    const admin = await p.user.create({ data: { role: 'SCHOOL_ADMIN', schoolId: school.id, staffNo: 'A1', passwordHash: 'x' } })
    const invite = await inviteRepo.create(p, { tokenHash: 'h1', schoolId: school.id, createdById: admin.id, expiresAt: new Date(Date.now() + 60_000) })
    expect((await p.schoolInvite.findUniqueOrThrow({ where: { id: invite.id } })).createdById).toBe(admin.id)

    await p.user.delete({ where: { id: admin.id } })

    const after = await p.schoolInvite.findUnique({ where: { id: invite.id } })
    expect(after).not.toBeNull() // not cascade-deleted
    expect(after?.createdById).toBeNull() // creator reference cleared
  })

  it('rejects an invite whose createdById points to no user (referential integrity enforced)', async () => {
    const p = db.prisma
    const school = await p.school.create({ data: { name: 'S2', code: 'S2' } })
    await expect(
      inviteRepo.create(p, { tokenHash: 'h2', schoolId: school.id, createdById: 999_999, expiresAt: new Date(Date.now() + 60_000) }),
    ).rejects.toThrow()
  })
})
