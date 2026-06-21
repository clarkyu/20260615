// AI authoring (备课出题) domain service. Drafts an assignment from a teacher's
// topic and/or a textbook photo. Gemini-backed (the configured multimodal model);
// degrades gracefully to `unavailable` when no key is set.

import { geminiAuthor, type AuthorDraft } from '@/lib/ai/providers/gemini'
import { logError } from '../log'
import { DEFAULT_AUTHOR_MODEL } from '@/lib/ai/registry'
import { isUnavailable } from './grading'

export type DraftOutcome =
  | { status: 'ok'; draft: AuthorDraft }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }

export async function draftAssignment(input: {
  topic: string
  imageBase64?: string
  imageMime?: string
}): Promise<DraftOutcome> {
  try {
    const draft = await geminiAuthor(
      { topic: input.topic, imageBase64: input.imageBase64, imageMime: input.imageMime },
      DEFAULT_AUTHOR_MODEL,
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
