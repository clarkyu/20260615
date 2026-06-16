'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { staffContext, staffSchoolContext } from '@/lib/action-context'
import { presignUpload, storageConfigured, chunkSetVideoKey } from '@/lib/storage'
import { parseChunks } from '@/lib/bank'
import { starterSets } from '@/lib/curriculum/starter-bank'
import * as bankRepo from '@/lib/repo/bank'
import { parseForm, reqText, optText, reqId, z } from '@/lib/validate'

type ActionState = { error?: string; success?: boolean }

const metaShape = { cefr: optText(20), strand: optText(60), domain: optText(30), tags: optText(300), source: optText(120) }
function metaFrom(d: { cefr?: string | null; strand?: string | null; domain?: string | null; tags?: string | null; source?: string | null }) {
  return { cefr: d.cefr ?? null, strand: d.strand ?? null, domain: d.domain ?? null, tags: d.tags ?? null, source: d.source ?? null }
}

// Create a chunk set from a name + pasted bilingual text (one sentence per line).
export async function createChunkSet(prevState: unknown, formData: FormData): Promise<ActionState> {
  const cx = await staffSchoolContext()
  if (!cx.ok) return { error: cx.error }
  const parsed = parseForm(z.object({ name: reqText('err.needSetName', 100), chunks: optText(200000), ...metaShape }), formData)
  if (!parsed.ok) return { error: cx.t(parsed.error) }
  const chunks = parseChunks(parsed.data.chunks ?? '')
  if (chunks.length === 0) return { error: cx.t('err.needChunks') }

  const id = await bankRepo.createWithChunks(cx.prisma, cx.schoolId, parsed.data.name, chunks, metaFrom(parsed.data))
  revalidatePath('/dashboard/bank')
  redirect(`/dashboard/bank/${id}`)
}

// One-click starter pack: import the curated curriculum seed sets into this
// school's bank. Idempotent — sets already imported (matched by source) are
// skipped, so it is safe to click again. Returns how many were newly added.
export async function importStarterBank(): Promise<{ imported: number; skipped: number; error?: string }> {
  const cx = await staffSchoolContext()
  if (!cx.ok) return { imported: 0, skipped: 0, error: cx.error }
  const existing = await bankRepo.importedSources(cx.prisma, cx.schoolId)
  let imported = 0
  let skipped = 0
  for (const set of starterSets()) {
    if (set.meta.source && existing.has(set.meta.source)) {
      skipped++
      continue
    }
    await bankRepo.createWithChunks(cx.prisma, cx.schoolId, set.name, set.chunks, set.meta)
    imported++
  }
  revalidatePath('/dashboard/bank')
  return { imported, skipped }
}

// Presigned URL for the chunk set's shadowing video; saves the key on the set.
export async function getChunkSetVideoUrl(chunkSetId: number, contentType: string, ext: string) {
  const { user, prisma, t } = await staffContext()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const set = await bankRepo.findForSchool(prisma, chunkSetId, user.schoolId)
  if (!set) return { error: t('err.setNotFound') }

  const key = chunkSetVideoKey(chunkSetId, ext || 'mp4')
  try {
    const url = await presignUpload(key, contentType)
    await bankRepo.setVideoKey(prisma, chunkSetId, key)
    return { url, key }
  } catch (err) {
    console.error('[getChunkSetVideoUrl] presign failed:', err)
    return { error: t('err.uploadUrlFail') }
  }
}

// Edit a set: rename + replace all chunks from the re-pasted three-part text.
export async function updateChunkSet(prevState: unknown, formData: FormData): Promise<ActionState> {
  const { user, prisma, t } = await staffContext()
  const parsed = parseForm(z.object({ chunkSetId: reqId, name: reqText('err.needSetName', 100), chunks: optText(200000), ...metaShape }), formData)
  if (!parsed.ok) return { error: t(parsed.error) }
  const { chunkSetId: id, name } = parsed.data
  const set = await bankRepo.findForSchool(prisma, id, user.schoolId)
  if (!set) return { error: t('err.setNotFound') }

  const chunks = parseChunks(parsed.data.chunks ?? '')
  if (chunks.length === 0) return { error: t('err.needChunks') }

  await bankRepo.replaceChunks(prisma, id, name, chunks, metaFrom(parsed.data))
  revalidatePath(`/dashboard/bank/${id}`)
  return { success: true }
}

export async function deleteChunkSet(formData: FormData): Promise<void> {
  const { user, prisma } = await staffContext()
  const id = Number(formData.get('chunkSetId'))
  await bankRepo.deleteForSchool(prisma, id, user.schoolId)
  revalidatePath('/dashboard/bank')
  redirect('/dashboard/bank')
}
