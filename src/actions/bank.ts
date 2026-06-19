'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { staffContext } from '@/lib/action-context'
import type { CurrentUser } from '@/lib/auth'
import { presignUpload, storageConfigured, chunkSetVideoKey } from '@/lib/storage'
import { parseChunks, splitIntoSets } from '@/lib/bank'
import { starterSets, englishFlowSets } from '@/lib/curriculum/starter-bank'
import { importPack, refreshPack } from '@/lib/domain/bank'
import * as bankRepo from '@/lib/repo/bank'
import { parseForm, reqText, optText, reqId, intField, checkbox, z } from '@/lib/validate'

type ActionState = { error?: string; success?: boolean }

// Star/unstar a bank set for the current teacher. Only sets visible to them.
export async function toggleBankFavorite(setId: number): Promise<{ favorited?: boolean; error?: string }> {
  const { user, prisma, t } = await staffContext()
  if (!Number.isInteger(setId)) return { error: t('err.setNotFound') }
  const set = await bankRepo.findSummaryVisible(prisma, setId, user.schoolId)
  if (!set) return { error: t('err.setNotFound') }
  const favorited = await bankRepo.toggleFavorite(prisma, user.userId, setId)
  revalidatePath('/dashboard/bank')
  return { favorited }
}

const metaShape = { cefr: optText(20), strand: optText(60), domain: optText(30), tags: optText(300), source: optText(120) }
// Manually-built sets are standalone (series: null); imports set their own series.
function metaFrom(d: { cefr?: string | null; strand?: string | null; domain?: string | null; tags?: string | null; source?: string | null }) {
  return { cefr: d.cefr ?? null, strand: d.strand ?? null, domain: d.domain ?? null, tags: d.tags ?? null, source: d.source ?? null, series: null }
}

const isSuper = (user: CurrentUser) => user.role === 'SUPER_ADMIN'

// Create a chunk set from a name + pasted bilingual text (one sentence per line).
// A super-admin may publish it to the platform-global pool via the `global` flag;
// everyone else writes to their own school.
export async function createChunkSet(prevState: unknown, formData: FormData): Promise<ActionState> {
  const { user, prisma, t } = await staffContext()
  const parsed = parseForm(z.object({ name: reqText('err.needSetName', 100), chunks: optText(200000), global: checkbox, ...metaShape }), formData)
  if (!parsed.ok) return { error: t(parsed.error) }
  const toGlobal = parsed.data.global && isSuper(user)
  if (!toGlobal && !user.schoolId) return { error: t('err.createSchoolFirst') }
  const chunks = parseChunks(parsed.data.chunks ?? '')
  if (chunks.length === 0) return { error: t('err.needChunks') }

  const scope: number | null = toGlobal ? null : (user.schoolId ?? null)
  const id = await bankRepo.createWithChunks(prisma, scope, parsed.data.name, chunks, metaFrom(parsed.data))
  revalidatePath('/dashboard/bank')
  redirect(`/dashboard/bank/${id}`)
}

// One-click starter pack import. A super-admin imports into the platform-global
// pool (one official copy visible to every school); an ordinary teacher imports
// into their own school. Idempotent — a source already present in the target's
// scope is skipped, so it never duplicates official content. Returns counts.
type ImportState = { imported?: number; skipped?: number; remaining?: number; error?: string }

export async function importStarterBank(): Promise<ImportState> {
  const { user, prisma, t } = await staffContext()
  const toGlobal = isSuper(user)
  if (!toGlobal && !user.schoolId) return { imported: 0, skipped: 0, error: t('err.createSchoolFirst') }
  const scope: number | null = toGlobal ? null : (user.schoolId ?? null)
  const existing = toGlobal ? await bankRepo.globalSources(prisma) : await bankRepo.visibleSources(prisma, user.schoolId)

  const res = await importPack(prisma, scope, starterSets(), existing)
  revalidatePath('/dashboard/bank')
  return res
}

// Import the built-in curated chunk pack as global official sets (super-admin
// only). Idempotent by source — safe to re-click, and a timed-out run resumes.
export async function importEnglishFlow(): Promise<ImportState> {
  const { user, prisma, t } = await staffContext()
  if (!isSuper(user)) return { imported: 0, skipped: 0, error: t('err.forbidden') }
  const existing = await bankRepo.globalSources(prisma)

  const res = await importPack(prisma, null, await englishFlowSets(), existing)
  revalidatePath('/dashboard/bank')
  return res
}

// Push the latest source content (notably newly-added Chinese translations) onto the
// already-imported official English-Flow sets (super-admin only). Idempotent +
// resumable: only sets whose source now has more Chinese than the live set get
// rebuilt; re-invoke until `remaining` is 0. Set ids are preserved (replaceChunks),
// so published assignments that reference these sets keep working.
export async function refreshEnglishFlow(): Promise<ImportState> {
  const { user, prisma, t } = await staffContext()
  if (!isSuper(user)) return { imported: 0, skipped: 0, error: t('err.forbidden') }
  const coverage = await bankRepo.globalSetZhCoverage(prisma)
  const res = await refreshPack(prisma, await englishFlowSets(), coverage)
  revalidatePath('/dashboard/bank')
  return res
}

// Generic pack importer (super-admin): paste a pack of three-part chunks, name it,
// classify it, and auto-split into sets of `perSet` — imported as global official.
// No per-pack code; idempotent by a name-derived source key.
export async function importPackAction(prevState: unknown, formData: FormData): Promise<ImportState> {
  const { user, prisma, t } = await staffContext()
  if (!isSuper(user)) return { error: t('err.forbidden') }
  const parsed = parseForm(
    z.object({ name: reqText('err.needSetName', 100), chunks: optText(2_000_000), perSet: intField(50, 1, 500), ...metaShape }),
    formData,
  )
  if (!parsed.ok) return { error: t(parsed.error) }
  const chunks = parseChunks(parsed.data.chunks ?? '')
  if (chunks.length === 0) return { error: t('err.needChunks') }

  const meta = metaFrom(parsed.data)
  // The pack name is its series, so all its sets group together in the bank.
  const sets = splitIntoSets(parsed.data.name, chunks, parsed.data.perSet).map((s) => ({
    name: s.name,
    chunks: s.chunks,
    meta: { ...meta, source: s.sourceKey, series: parsed.data.name },
  }))
  const existing = await bankRepo.globalSources(prisma)
  const res = await importPack(prisma, null, sets, existing)
  revalidatePath('/dashboard/bank')
  return res
}

// Presigned URL for the chunk set's shadowing video; saves the key on the set.
export async function getChunkSetVideoUrl(chunkSetId: number, contentType: string, ext: string) {
  const { user, prisma, t } = await staffContext()
  if (!storageConfigured()) return { error: t('err.storageNot') }
  const set = await bankRepo.findOwned(prisma, chunkSetId, user.schoolId, isSuper(user))
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
// Scope is fixed at creation; editing never moves a set between pools.
export async function updateChunkSet(prevState: unknown, formData: FormData): Promise<ActionState> {
  const { user, prisma, t } = await staffContext()
  const parsed = parseForm(z.object({ chunkSetId: reqId, name: reqText('err.needSetName', 100), chunks: optText(200000), ...metaShape }), formData)
  if (!parsed.ok) return { error: t(parsed.error) }
  const { chunkSetId: id, name } = parsed.data
  const set = await bankRepo.findOwned(prisma, id, user.schoolId, isSuper(user))
  if (!set) return { error: t('err.setNotFound') }

  const chunks = parseChunks(parsed.data.chunks ?? '')
  if (chunks.length === 0) return { error: t('err.needChunks') }

  await bankRepo.replaceChunks(prisma, id, name, chunks, metaFrom(parsed.data))
  revalidatePath(`/dashboard/bank/${id}`)
  revalidatePath(`/dashboard/bank/${id}/publish`) // keep the publish screen's summary in sync after an inline edit
  return { success: true }
}

export async function deleteChunkSet(formData: FormData): Promise<void> {
  const { user, prisma } = await staffContext()
  const id = Number(formData.get('chunkSetId'))
  await bankRepo.deleteOwned(prisma, id, user.schoolId, isSuper(user))
  revalidatePath('/dashboard/bank')
  redirect('/dashboard/bank')
}
