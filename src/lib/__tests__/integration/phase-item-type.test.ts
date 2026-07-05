import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { createWithPhases, type PhaseInput } from '@/lib/repo/assignments'
import type { PrismaClient } from '@prisma/client'

// End-to-end proof that the itemType foundation actually lands in the database: the
// 0042 migration's column exists on a real (migration-built) SQLite schema, and the
// repo write funnel (phaseData) persists the value derived by phaseItemType(). Direct
// prisma.phase.create() elsewhere leaves itemType null by design; this drives the real
// authoring write path instead.

const phase = (over: Partial<PhaseInput>): PhaseInput => ({
  id: null,
  order: 1,
  title: null,
  category: null,
  instructions: null,
  chunkSetId: null,
  shadowVideoKey: null,
  openAt: null,
  dueAt: null,
  requireEyesClosed: false,
  requireText: false,
  requireAudio: false,
  requireVideo: false,
  requireHandwriting: false,
  graded: true,
  maxAttempts: 1,
  weight: 1,
  isFormalTest: false,
  freePractice: false,
  sentences: [],
  ...over,
})

async function seedOffering(p: PrismaClient) {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'E', code: 'E' } })
  const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'C1' } })
  const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '1' } })
  return offering.id
}

describe('itemType is persisted by the real authoring write path', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('createWithPhases stores speech / objective / writing per the derivation', async () => {
    const offeringId = await seedOffering(db.prisma)
    await createWithPhases(db.prisma, offeringId, { title: 'A', monthLabel: null }, [
      phase({ order: 1, requireAudio: true, sentences: [{ order: 1, text: 'Hi' }] }), // → speech
      phase({ order: 2, requireChoice: true, choicesJson: JSON.stringify(['A', 'B']), correctChoice: 'A' }), // → objective
      phase({ order: 3, requireFreeText: true }), // → writing
    ])

    const phases = await db.prisma.phase.findMany({ orderBy: { order: 'asc' }, select: { order: true, itemType: true } })
    expect(phases).toEqual([
      { order: 1, itemType: 'speech' },
      { order: 2, itemType: 'objective' },
      { order: 3, itemType: 'writing' },
    ])
  })

  it('a recite-text + eyes-closed video phase (背诵) stores speech', async () => {
    const offeringId = await seedOffering(db.prisma)
    await createWithPhases(db.prisma, offeringId, { title: 'B', monthLabel: null }, [
      phase({ requireText: true, requireVideo: true, requireEyesClosed: true, sentences: [{ order: 1, text: 'Hi' }] }),
    ])
    const only = await db.prisma.phase.findFirstOrThrow({ select: { itemType: true } })
    expect(only.itemType).toBe('speech')
  })
})
