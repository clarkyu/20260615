'use server'

import { staffContext } from '@/lib/action-context'
import { draftAssignment } from '@/lib/domain/authoring'
import { resolveTeacherKeys } from '@/lib/ai/teacher-keys'
import { withAiKeys } from '@/lib/ai/key-context'

export interface DraftFields {
  title: string
  category: string
  instructions: string
  sentences: string // newline-joined, ready for the form's textarea
}

export type DraftResult =
  | { status: 'ok'; draft: DraftFields }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }

const MAX_IMAGE_BYTES = 6 * 1024 * 1024

// Drafts an assignment from a topic and/or a textbook photo. The photo is sent
// inline (base64) to the model — no R2 round-trip needed for authoring.
export async function draftAssignmentAction(formData: FormData): Promise<DraftResult> {
  const { user, prisma, t } = await staffContext()

  const topic = ((formData.get('topic') as string) ?? '').trim()
  const model = ((formData.get('authorModel') as string) ?? '').trim() || undefined
  const image = formData.get('image')
  const hasImage = image instanceof File && image.size > 0
  if (!topic && !hasImage) return { status: 'error', message: t('author.needInput') }

  let imageBase64: string | undefined
  let imageMime: string | undefined
  if (hasImage) {
    const file = image as File
    if (file.size > MAX_IMAGE_BYTES) return { status: 'error', message: t('author.imageTooBig') }
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    imageBase64 = btoa(binary)
    imageMime = file.type || 'image/jpeg'
  }

  // Use the authoring teacher's own key (BYOK); empty → platform key.
  const keys = await resolveTeacherKeys(prisma, user.userId)
  const outcome = await withAiKeys(keys, () => draftAssignment({ topic, imageBase64, imageMime, model }))
  if (outcome.status === 'unavailable') return { status: 'unavailable' }
  if (outcome.status === 'error') return { status: 'error', message: t('author.failed') }

  return {
    status: 'ok',
    draft: {
      title: outcome.draft.title,
      category: outcome.draft.category,
      instructions: outcome.draft.instructions,
      sentences: outcome.draft.sentences.join('\n'),
    },
  }
}
