'use server'

import { revalidatePath } from 'next/cache'
import { authedContext, staffContext } from '@/lib/action-context'
import * as feedbackRepo from '@/lib/repo/feedback'

type State = { error?: string; success?: boolean }

// Any logged-in user can submit feedback. +10 points per submission (derived).
export async function submitFeedback(prevState: unknown, formData: FormData): Promise<State> {
  const { user, prisma, t } = await authedContext()

  const body = String(formData.get('body') ?? '').trim()
  if (!body) return { error: t('fb.needBody') }
  if (body.length > 5000) return { error: t('fb.tooLong') }

  await feedbackRepo.create(prisma, { userId: user.userId, schoolId: user.schoolId ?? null, body })
  revalidatePath('/feedback')
  return { success: true }
}

// Adopt / decline a piece of feedback (super-admin only). Adopting grants +100.
export async function reviewFeedback(formData: FormData): Promise<void> {
  const { user, prisma } = await staffContext()
  if (user.role !== 'SUPER_ADMIN') return
  const id = Number(formData.get('feedbackId'))
  const action = String(formData.get('action') ?? '')
  const reply = String(formData.get('reply') ?? '').trim() || null
  const status = action === 'adopt' ? 'ADOPTED' : action === 'decline' ? 'DECLINED' : action === 'reset' ? 'PENDING' : null
  if (!Number.isInteger(id) || !status) return
  await feedbackRepo.setStatus(prisma, id, status, reply)
  revalidatePath('/feedback')
}
