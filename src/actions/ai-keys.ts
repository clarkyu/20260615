'use server'

import { revalidatePath } from 'next/cache'
import { staffContext } from '@/lib/action-context'
import { encryptSecret } from '@/lib/crypto'
import { CREDENTIAL_SLOT_IDS } from '@/lib/ai/registry'
import * as aiKeyRepo from '@/lib/repo/ai-keys'

type State = { ok?: boolean; error?: string }

// Save (or replace) the teacher's own API key for one provider slot. The plaintext
// key is encrypted before it touches the DB and never returned to the client.
export async function saveAiKey(prevState: unknown, formData: FormData): Promise<State> {
  const { user, prisma, t } = await staffContext()
  const provider = String(formData.get('provider') ?? '')
  const key = String(formData.get('key') ?? '').trim()
  if (!CREDENTIAL_SLOT_IDS.includes(provider)) return { error: t('err.invalidCreds') }
  if (key.length < 12) return { error: t('err.keyTooShort') }

  const { ciphertext, iv } = await encryptSecret(key)
  await aiKeyRepo.upsert(prisma, user.userId, provider, { ciphertext, iv, last4: key.slice(-4) })
  revalidatePath('/profile/ai')
  return { ok: true }
}

export async function deleteAiKey(formData: FormData): Promise<void> {
  const { user, prisma } = await staffContext()
  const provider = String(formData.get('provider') ?? '')
  if (CREDENTIAL_SLOT_IDS.includes(provider)) await aiKeyRepo.remove(prisma, user.userId, provider)
  revalidatePath('/profile/ai')
}
