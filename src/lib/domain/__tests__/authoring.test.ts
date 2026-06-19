/* eslint-disable @typescript-eslint/no-explicit-any -- controllable mock impl */
import { describe, it, expect, vi } from 'vitest'
import { unavailable } from '@/lib/ai/errors'

// Drive geminiAuthor through a plain (non-spy) function so a thrown rejection is created
// only on call and consumed by draftAssignment's await — a vi.fn spy re-surfaces it as an
// "unhandled" rejection. Keep the module's other exports (geminiPerception, …) intact,
// since the grading import chain pulls them in via the AI adapters.
const h = vi.hoisted(() => ({ impl: (async () => ({ sentences: [] })) as (...a: any[]) => Promise<any> }))
vi.mock('@/lib/ai/providers/gemini', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/ai/providers/gemini')>()),
  geminiAuthor: (...args: any[]) => h.impl(...args),
}))

import { draftAssignment } from '../authoring'

describe('draftAssignment', () => {
  it('returns the draft on success', async () => {
    const draft = { sentences: [{ english: 'Hi', chinese: '嗨' }] }
    h.impl = async () => draft
    expect(await draftAssignment({ topic: 'greetings' })).toEqual({ status: 'ok', draft })
  })

  it('maps an empty draft to an error', async () => {
    h.impl = async () => ({ sentences: [] })
    expect(await draftAssignment({ topic: 'x' })).toEqual({ status: 'error', message: 'empty draft' })
  })

  it('degrades to "unavailable" when the model key is missing', async () => {
    h.impl = async () => { throw unavailable('GEMINI_API_KEY 未配置') }
    expect(await draftAssignment({ topic: 'x' })).toEqual({ status: 'unavailable' })
  })

  it('surfaces a genuine failure as an error', async () => {
    h.impl = async () => { throw new Error('500 upstream') }
    expect(await draftAssignment({ topic: 'x' })).toEqual({ status: 'error', message: '500 upstream' })
  })
})
