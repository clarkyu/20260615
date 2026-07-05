/* eslint-disable @typescript-eslint/no-explicit-any -- controllable mock impl */
import { describe, it, expect, vi } from 'vitest'
import { unavailable } from '@/lib/ai/errors'

// Authoring routes through the pluggable author adapter (getAuthorProvider). Drive it
// through a plain (non-spy) function so a thrown rejection is created only on call and
// consumed by draftAssignment's await — a vi.fn spy re-surfaces it as an "unhandled"
// rejection. Keep the module's other exports intact so the real registry (provider
// lookup) still resolves.
const h = vi.hoisted(() => ({ impl: (async () => ({ sentences: [] })) as (...a: any[]) => Promise<any> }))
vi.mock('@/lib/ai/adapters', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/ai/adapters')>()),
  getAuthorProvider: () => ({ author: (...args: any[]) => h.impl(...args) }),
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
    h.impl = async () => { throw unavailable('DEEPSEEK_API_KEY 未配置') }
    expect(await draftAssignment({ topic: 'x' })).toEqual({ status: 'unavailable' })
  })

  it('surfaces a genuine failure as an error', async () => {
    h.impl = async () => { throw new Error('500 upstream') }
    expect(await draftAssignment({ topic: 'x' })).toEqual({ status: 'error', message: '500 upstream' })
  })

  it('routes the chosen model id through to the provider', async () => {
    let seenModel: string | undefined
    h.impl = async (_input: any, modelId: string) => { seenModel = modelId; return { sentences: ['a'] } }
    await draftAssignment({ topic: 'x', model: 'claude-opus-4-8' })
    expect(seenModel).toBe('claude-opus-4-8')
  })

  it('forces a textbook photo onto a multimodal (Gemini) model even if a text model is picked', async () => {
    let seenModel: string | undefined
    h.impl = async (_input: any, modelId: string) => { seenModel = modelId; return { sentences: ['a'] } }
    await draftAssignment({ topic: 'x', model: 'deepseek-v4-flash', imageBase64: 'zzz', imageMime: 'image/jpeg' })
    expect(seenModel).toBe('gemini-2.5-flash')
  })
})
