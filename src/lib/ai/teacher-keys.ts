import type { PrismaClient } from '@prisma/client'
import { decryptSecret } from '@/lib/crypto'
import { CREDENTIAL_SLOTS } from './registry'
import * as aiKeyRepo from '@/lib/repo/ai-keys'

// Decrypt a teacher's BYOK keys into a provider→key map. One slot can power several
// providers (the OpenAI slot covers both gpt-4o and whisper). Best-effort: any error
// (no keys, undecryptable row) yields an empty/partial map, so grading falls back to
// the platform key rather than failing.
export async function resolveTeacherKeys(prisma: PrismaClient, teacherId: number | null | undefined): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  if (!teacherId) return map
  try {
    for (const row of await aiKeyRepo.listSecretsForUser(prisma, teacherId)) {
      const slot = CREDENTIAL_SLOTS.find((s) => s.id === row.provider)
      if (!slot) continue
      try {
        const key = await decryptSecret(row.ciphertext, row.iv)
        for (const p of slot.providers) map[p] = key
      } catch { /* skip undecryptable row → platform key */ }
    }
  } catch { /* table/query issue → platform key */ }
  return map
}
