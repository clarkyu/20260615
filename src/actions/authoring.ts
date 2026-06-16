'use server'

import { requireStaff } from '@/lib/auth'
import { getT } from '@/lib/i18n-server'
import { draftAssignment } from '@/lib/domain/authoring'

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
  await requireStaff()
  const { t } = await getT()

  const topic = ((formData.get('topic') as string) ?? '').trim()
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

  const outcome = await draftAssignment({ topic, imageBase64, imageMime })
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
