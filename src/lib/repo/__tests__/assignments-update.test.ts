import { describe, it, expect } from 'vitest'
import { updateWithPhases, type PhaseInput } from '@/lib/repo/assignments'

// Guards the CRITICAL invariant: editing an assignment must RECONCILE phases by id —
// kept phases are updated in place (never deleted), so their Submissions /
// PracticeAttempts (which cascade-delete with their Phase) survive the edit. Plus the
// optimistic-lock fence: a save whose loaded version is stale is rejected wholesale.

const phase = (over: Partial<PhaseInput> = {}): PhaseInput => ({
  id: null, order: 1, title: null, category: null, instructions: null, chunkSetId: null, shadowVideoKey: null,
  openAt: null, dueAt: null, requireEyesClosed: false, requireText: false, requireAudio: true,
  requireVideo: false, requireHandwriting: false, graded: true, maxAttempts: 1, weight: 1, isFormalTest: false, freePractice: false, sentences: [], ...over,
})
const meta = { title: 'T', monthLabel: null }

function fakePrisma(existingPhaseIds: number[], currentVersion = 0) {
  const calls = { phaseUpdate: [] as number[], phaseCreate: 0, phaseDeleteMany: [] as number[][], assignmentUpdate: 0 }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    phase: {
      findMany: async () => existingPhaseIds.map((id) => ({ id })),
      update: async (args: { where: { id: number } }) => { calls.phaseUpdate.push(args.where.id); return {} },
      create: async () => { calls.phaseCreate++; return { id: 900 + calls.phaseCreate } },
      deleteMany: async (args: { where: { id: { in: number[] } } }) => { calls.phaseDeleteMany.push(args.where.id.in); return { count: args.where.id.in.length } },
    },
    // Optimistic-lock fence: the claim succeeds (count 1) only when the expected version matches.
    assignment: { updateMany: async (args: { where: { version: number } }) => { calls.assignmentUpdate++; return { count: args.where.version === currentVersion ? 1 : 0 } } },
    sentence: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  }
  return { prisma, calls }
}

describe('updateWithPhases — reconcile by id (no data loss on edit)', () => {
  it('updates every kept phase in place and deletes none', async () => {
    const { prisma, calls } = fakePrisma([10, 11])
    const r = await updateWithPhases(prisma, 1, meta, [phase({ id: 10 }), phase({ id: 11, order: 2 })], [10, 11], 0)
    expect(r).toEqual({ ok: true })
    expect(calls.phaseUpdate.sort()).toEqual([10, 11])
    expect(calls.phaseCreate).toBe(0)
    expect(calls.phaseDeleteMany).toEqual([]) // nothing removed → no cascade delete
  })

  it('creates a newly-added phase and deletes only the removed one', async () => {
    const { prisma, calls } = fakePrisma([10, 11])
    // keep 10, drop 11 (both were loaded), add a brand-new phase (id null)
    await updateWithPhases(prisma, 1, meta, [phase({ id: 10 }), phase({ id: null, order: 2 })], [10, 11], 0)
    expect(calls.phaseUpdate).toEqual([10])
    expect(calls.phaseCreate).toBe(1)
    expect(calls.phaseDeleteMany).toEqual([[11]]) // only the loaded-then-removed phase cascades
  })

  it('a no-op save (all ids kept) deletes nothing', async () => {
    const { prisma, calls } = fakePrisma([10])
    await updateWithPhases(prisma, 1, meta, [phase({ id: 10 })], [10], 0)
    expect(calls.phaseDeleteMany).toEqual([])
    expect(calls.phaseUpdate).toEqual([10])
  })

  it('never deletes a phase added concurrently (not in knownPhaseIds) — a stale save keeps its submissions (audit P2-9)', async () => {
    const { prisma, calls } = fakePrisma([10, 11]) // phase 11 was added after the form loaded
    // The form only ever loaded phase 10; it keeps 10 and knows nothing about 11.
    await updateWithPhases(prisma, 1, meta, [phase({ id: 10 })], [10], 0)
    expect(calls.phaseUpdate).toEqual([10])
    expect(calls.phaseDeleteMany).toEqual([]) // phase 11 preserved, NOT cascade-deleted
  })

  it('with no known ids, deletes nothing (fail-safe — never destroy submissions on a malformed save)', async () => {
    const { prisma, calls } = fakePrisma([10, 11])
    await updateWithPhases(prisma, 1, meta, [phase({ id: 10 })], [], 0)
    expect(calls.phaseDeleteMany).toEqual([])
  })

  it('rejects a stale save (version moved since load) without touching any phase (audit P2-9)', async () => {
    const { prisma, calls } = fakePrisma([10, 11], 3) // the assignment is now at version 3
    // The form loaded version 1 — someone else has since saved. The claim must fail.
    const r = await updateWithPhases(prisma, 1, meta, [phase({ id: 10 })], [10, 11], 1)
    expect(r).toEqual({ ok: false, conflict: true })
    expect(calls.assignmentUpdate).toBe(1) // the guarded claim ran…
    expect(calls.phaseUpdate).toEqual([]) // …but nothing else did
    expect(calls.phaseCreate).toBe(0)
    expect(calls.phaseDeleteMany).toEqual([]) // no phase deleted → no submissions destroyed
  })
})
