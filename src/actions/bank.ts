'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireStaff } from '@/lib/auth'
import { getT } from '@/lib/i18n-server'
import { presignUpload, storageConfigured, chunkSetVideoKey } from '@/lib/storage'
import { parseChunks } from '@/lib/bank'

type ActionState = { error?: string; success?: boolean }

// Create a chunk set from a name + pasted bilingual text (one sentence per line).
export async function createChunkSet(prevState: unknown, formData: FormData): Promise<ActionState> {
  const user = await requireStaff()
  const { t } = await getT()
  const prisma = await getDb()
  if (!user.schoolId) return { error: t('err.createSchoolFirst') }

  const name = (formData.get('name') as string)?.trim()
  const chunks = parseChunks((formData.get('chunks') as string) ?? '')
  if (!name) return { error: t('err.needSetName') }
  if (chunks.length === 0) return { error: t('err.needChunks') }

  // Standalone create (not nested in $transaction) so D1 can resolve the new id.
  const set = await prisma.chunkSet.create({ data: { schoolId: user.schoolId, name } })
  await prisma.chunk.createMany({
    data: chunks.map((c, i) => ({
      chunkSetId: set.id,
      order: i + 1,
      english: c.english,
      chinese: c.chinese,
      meaningEn: c.meaningEn,
      meaningZh: c.meaningZh,
      exampleEn: c.exampleEn,
      exampleZh: c.exampleZh,
    })),
  })
  revalidatePath('/dashboard/bank')
  redirect(`/dashboard/bank/${set.id}`)
}

// Presigned URL for the chunk set's shadowing video; saves the key on the set.
export async function getChunkSetVideoUrl(chunkSetId: number, contentType: string, ext: string) {
  const user = await requireStaff()
  const { t } = await getT()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const prisma = await getDb()
  const set = await prisma.chunkSet.findFirst({ where: { id: chunkSetId, schoolId: user.schoolId ?? -1 } })
  if (!set) return { error: t('err.setNotFound') }

  const key = chunkSetVideoKey(chunkSetId, ext || 'mp4')
  try {
    const url = await presignUpload(key, contentType)
    await prisma.chunkSet.update({ where: { id: chunkSetId }, data: { shadowVideoKey: key } })
    return { url, key }
  } catch (err) {
    console.error('[getChunkSetVideoUrl] presign failed:', err)
    return { error: t('err.uploadUrlFail') }
  }
}

export async function deleteChunkSet(formData: FormData): Promise<void> {
  const user = await requireStaff()
  const prisma = await getDb()
  const id = Number(formData.get('chunkSetId'))
  const set = await prisma.chunkSet.findFirst({ where: { id, schoolId: user.schoolId ?? -1 } })
  if (set) await prisma.chunkSet.delete({ where: { id } })
  revalidatePath('/dashboard/bank')
  redirect('/dashboard/bank')
}
