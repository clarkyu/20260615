import { describe, it, expect } from 'vitest'
import { updateWithPhases, type PhaseInput } from '@/lib/repo/assignments'

// Guards the CRITICAL invariant: editing an assignment must RECONCILE phases by id —
// kept phases are updated in place (never deleted), so their Submissions /
// PracticeAttempts (which cascade-delete with their Phase) survive the edit.

const phase = (over: Partial<PhaseInput> = {}): PhaseInput => ({
  id: null, order: 1, title: null, category: null, instructions: null, chunkSetId: null, shadowVideoKey: null,
  openAt: null, dueAt: null, requireEyesClosed: false, requireText: false, requireAudio: true,
  requireVideo: false, requireHandwriting: false, graded: true, maxAttempts: 1, sentences: [], ...over,
})
const meta = { title: 'T', monthLabel: null }

function fakePrisma(existingPhaseIds: number[]) {
  const calls = { phaseUpdate: [] as number[], phaseCreate: 0, phaseDeleteMany: [] as number[][], assignmentUpdate: 0 }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    phase: {
      findMany: async () => existingPhaseIds.map((id) => ({ id })),
      update: async (args: { where: { id: number } }) => { calls.phaseUpdate.push(args.where.id); return {} },
      create: async () => { calls.phaseCreate++; return { id: 900 + calls.phaseCreate } },
      deleteMany: async (args: { where: { id: { in: number[] } } }) => { calls.phaseDeleteMany.push(args.where.id.in); return { count: args.where.id.in.length } },
    },
    assignment: { update: async () => { calls.assignmentUpdate++; return {} } },
    sentence: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  }
  return { prisma, calls }
}

describe('updateWithPhases — reconcile by id (no data loss on edit)', () => {
  it('updates every kept phase in place and deletes none', async () => {
    const { prisma, calls } = fakePrisma([10, 11])
    await updateWithPhases(prisma, 1, meta, [phase({ id: 10 }), phase({ id: 11, order: 2 })])
    expect(calls.phaseUpdate.sort()).toEqual([10, 11])
    expect(calls.phaseCreate).toBe(0)
    expect(calls.phaseDeleteMany).toEqual([]) // nothing removed → no cascade delete
  })

  it('creates a newly-added phase and deletes only the removed one', async () => {
    const { prisma, calls } = fakePrisma([10, 11])
    // keep 10, drop 11, add a brand-new phase (id null)
    await updateWithPhases(prisma, 1, meta, [phase({ id: 10 }), phase({ id: null, order: 2 })])
    expect(calls.phaseUpdate).toEqual([10])
    expect(calls.phaseCreate).toBe(1)
    expect(calls.phaseDeleteMany).toEqual([[11]]) // only the removed phase cascades
  })

  it('a no-op save (all ids kept) deletes nothing', async () => {
    const { prisma, calls } = fakePrisma([10])
    await updateWithPhases(prisma, 1, meta, [phase({ id: 10 })])
    expect(calls.phaseDeleteMany).toEqual([])
    expect(calls.phaseUpdate).toEqual([10])
  })
})
