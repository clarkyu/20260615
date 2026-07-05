// AI authoring (备课出题) domain service. Drafts an assignment from a teacher's
// topic and/or a textbook photo. Pluggable: the teacher's chosen model routes to the
// matching provider (DeepSeek by default for text; Gemini for the photo path).
// Degrades gracefully to `unavailable` when the chosen provider's key is missing.

import type { AuthorDraft } from '@/lib/ai/types'
import { getAuthorProvider } from '@/lib/ai/adapters'
import { getModel, resolveAuthorModel } from '@/lib/ai/registry'
import { logError } from '../log'
import { isUnavailable } from './grading'

export type DraftOutcome =
  | { status: 'ok'; draft: AuthorDraft }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }

export async function draftAssignment(input: {
  topic: string
  imageBase64?: string
  imageMime?: string
  // Teacher's preferred author model id; empty/unknown → registry default.
  model?: string
}): Promise<DraftOutcome> {
  const hasImage = Boolean(input.imageBase64 && input.imageMime)
  const modelId = resolveAuthorModel(input.model, hasImage)
  const provider = getModel(modelId)?.provider
  const author = provider ? getAuthorProvider(provider) : undefined
  if (!author) return { status: 'error', message: `no author provider for ${modelId}` }
  try {
    const draft = await author.author(
      { topic: input.topic, imageBase64: input.imageBase64, imageMime: input.imageMime },
      modelId,
    )
    if (draft.sentences.length === 0) return { status: 'error', message: 'empty draft' }
    return { status: 'ok', draft }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'draft failed'
    if (isUnavailable(message)) return { status: 'unavailable' }
    logError('draftAssignment', 'failed', err)
    return { status: 'error', message }
  }
}
