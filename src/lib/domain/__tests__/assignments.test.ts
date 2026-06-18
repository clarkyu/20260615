import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// Mock the repos createAssignments/updateAssignment reach, so we can assert exactly
// what phase shape the domain resolves and hands to the data layer.
vi.mock('@/lib/repo/offerings', () => ({
  findIdsForSchool: vi.fn(async (_p: unknown, ids: number[]) => ids),
}))
vi.mock('@/lib/repo/bank', () => ({
  findWithChunksVisible: vi.fn(async () => ({
    id: 9,
    shadowVideoKey: 'vid-key',
    chunks: [
      { english: 'Hi', chinese: '嗨', exampleEn: 'Hi there.', exampleZh: '你好啊。' },
      { english: 'Bye', chinese: '拜', exampleEn: 'Bye now.', exampleZh: '再见。' },
    ],
  })),
}))
vi.mock('@/lib/repo/assignments', () => ({
  createWithPhases: vi.fn(async () => ({ id: 1 })),
  updateWithPhases: vi.fn(async () => undefined),
  findForSchool: vi.fn(async () => ({ id: 1 })),
}))

import { createAssignments, updateAssignment, type PhaseDraft } from '@/lib/domain/assignments'
import * as assignmentsRepo from '@/lib/repo/assignments'

const prisma = {} as never
const meta = { title: 'T', category: null, monthLabel: null }
const draft = (over: Partial<PhaseDraft> = {}): PhaseDraft => ({
  id: null,
  title: null,
  instructions: null,
  useBankSet: false,
  typedSentences: [],
  openAt: null,
  dueAt: null,
  requireEyesClosed: false,
  requireText: false,
  requireAudio: false,
  requireVideo: false,
  requireHandwriting: false,
  graded: true,
  maxAttempts: 1,
  ...over,
})

const created = assignmentsRepo.createWithPhases as Mock
const lastPhases = () => created.mock.calls.at(-1)![3]

beforeEach(() => vi.clearAllMocks())

describe('createAssignments — phase resolution', () => {
  it('maps a typed phase to ordered sentences with no bank link', async () => {
    const res = await createAssignments(prisma, 1, meta, [draft({ typedSentences: ['a', 'b'], requireAudio: true })], [10], null, null)
    expect(res).toEqual({ ok: true, redirectTo: '/dashboard/teaching/10' })
    expect(created).toHaveBeenCalledTimes(1)
    const phases = lastPhases()
    expect(phases).toHaveLength(1)
    expect(phases[0]).toMatchObject({ order: 1, chunkSetId: null, shadowVideoKey: null, requireAudio: true })
    expect(phases[0].sentences).toEqual([
      { order: 1, text: 'a', translation: null },
      { order: 2, text: 'b', translation: null },
    ])
  })

  it('pulls sentences + shadow video from the bank set, for every useBankSet phase', async () => {
    // ① 跟读 (audio) ② 闭眼背诵 (video, eyes) — both from the same set.
    await createAssignments(
      prisma,
      1,
      meta,
      [draft({ useBankSet: true, requireAudio: true }), draft({ useBankSet: true, requireVideo: true, requireEyesClosed: true })],
      [10],
      9,
      null,
    )
    const phases = lastPhases()
    expect(phases).toHaveLength(2)
    for (const p of phases) {
      expect(p.chunkSetId).toBe(9)
      expect(p.shadowVideoKey).toBe('vid-key')
      expect(p.sentences[0]).toEqual({ order: 1, text: 'Hi there.', translation: '你好啊。' })
    }
    expect(phases[0]).toMatchObject({ order: 1, requireAudio: true, requireEyesClosed: false })
    expect(phases[1]).toMatchObject({ order: 2, requireVideo: true, requireEyesClosed: true })
  })

  it('rejects a phase with no submission kind, and writes nothing', async () => {
    const res = await createAssignments(prisma, 1, meta, [draft({ typedSentences: ['a'] })], [10], null, null)
    expect(res).toEqual({ ok: false, error: 'err.needSubmitKind' })
    expect(created).not.toHaveBeenCalled()
  })

  it('rejects an empty phase list', async () => {
    const res = await createAssignments(prisma, 1, meta, [], [10], null, null)
    expect(res).toEqual({ ok: false, error: 'err.needPhase' })
    expect(created).not.toHaveBeenCalled()
  })

  it('rejects when no publish target resolves', async () => {
    const res = await createAssignments(prisma, 1, meta, [draft({ requireAudio: true, typedSentences: ['a'] })], [], null, null)
    expect(res).toEqual({ ok: false, error: 'err.needPublishTarget' })
  })
})

describe('updateAssignment — phase resolution', () => {
  it('replaces phases via updateWithPhases', async () => {
    const res = await updateAssignment(prisma, 1, 42, meta, [draft({ requireVideo: true, typedSentences: ['x'] })], null)
    expect(res).toEqual({ ok: true })
    expect(assignmentsRepo.updateWithPhases as Mock).toHaveBeenCalledTimes(1)
    const call = (assignmentsRepo.updateWithPhases as Mock).mock.calls[0]
    expect(call[1]).toBe(42)
    expect(call[3][0]).toMatchObject({ order: 1, requireVideo: true })
  })
})
