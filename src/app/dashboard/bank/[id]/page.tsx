import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft, ClipboardPen, Video, Layers } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as bankRepo from '@/lib/repo/bank'
import { serializeChunks } from '@/lib/bank'
import { presignDownload, storageConfigured } from '@/lib/storage'
import { CEFR_LEVELS, STRANDS } from '@/lib/curriculum/taxonomy'
import { Button } from '@/components/ui/button'
import { SubmitButton } from '@/components/submit-button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { deleteChunkSet } from '@/actions/bank'
import { VideoUpload } from './video-upload'
import { EditSetForm } from './edit-set-form'

export default async function ChunkSetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const setId = Number(id)
  if (!Number.isInteger(setId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  const isSuperAdmin = user.role === 'SUPER_ADMIN'
  if (!user.schoolId && !isSuperAdmin) redirect('/dashboard')

  const set = await bankRepo.findWithChunksVisible(prisma, setId, user.schoolId)
  if (!set) notFound()

  // Official (global) sets are read-only to ordinary teachers — they can publish
  // from them but not edit/delete/replace the video. A super-admin owns the global pool.
  const isGlobal = set.schoolId === null
  const canEdit = isGlobal ? isSuperAdmin : set.schoolId === user.schoolId
  // Presigned playback URL so EVERY viewer can watch the shadowing video.
  const videoUrl = set.shadowVideoKey && storageConfigured() ? await presignDownload(set.shadowVideoKey) : null
  const tags = (set.tags ?? '').split(',').map((x) => x.trim()).filter(Boolean)

  return (
    <div className="space-y-5 py-2">
      <Link href="/dashboard/bank" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{t('bank.title')}
      </Link>

      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">{set.name}</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          {isGlobal ? <Badge tone="success">{t('bank.official')}</Badge> : null}
          {set.series ? (
            <Link href={`/dashboard/bank?series=${encodeURIComponent(set.series)}`}>
              <Badge className="gap-1"><Layers className="h-3 w-3" />{set.series}</Badge>
            </Link>
          ) : null}
          {set.cefr ? <Badge tone="primary">{CEFR_LEVELS.find((l) => l.band === set.cefr)?.label ?? set.cefr}</Badge> : null}
          {set.strand ? <Badge>{STRANDS.find((s) => s.id === set.strand)?.label ?? set.strand}</Badge> : null}
          {tags.map((tag) => (
            <span key={tag} className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{tag}</span>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{set.chunks.length} {t('bank.chunkUnit')}</p>
      </div>

      {/* Primary action */}
      <Link href={`/dashboard/bank/${set.id}/publish`}>
        <Button className="w-full" size="lg"><ClipboardPen className="h-4 w-4" />{t('bank.publish')}</Button>
      </Link>

      {/* Shadowing video — visible to all viewers */}
      {videoUrl ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><Video className="h-4 w-4 text-primary" />{t('shadow.title')}</div>
            <video src={videoUrl} controls playsInline preload="metadata" className="max-h-[60vh] w-full rounded-xl bg-black" />
          </CardContent>
        </Card>
      ) : null}

      {/* Sentences */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('bank.chunkList')}</h2>
        <Card>
          <CardContent className="divide-y divide-border/60 p-0">
            {set.chunks.map((c) => (
              <div key={c.id} className="flex gap-3 p-3.5 text-sm">
                <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{c.order}</span>
                <div className="min-w-0 space-y-1.5">
                  <div>
                    <div className="font-semibold">{c.english}</div>
                    {c.chinese ? <div className="text-xs text-muted-foreground">{c.chinese}</div> : null}
                  </div>
                  {c.meaningEn ? (
                    <div className="text-xs">
                      <span className="text-muted-foreground">{t('bank.meaning')}：</span>{c.meaningEn}
                      {c.meaningZh ? <span className="text-muted-foreground"> / {c.meaningZh}</span> : null}
                    </div>
                  ) : null}
                  {c.exampleEn ? (
                    <div className="text-xs">
                      <span className="text-muted-foreground">{t('bank.example')}：</span>{c.exampleEn}
                      {c.exampleZh ? <span className="text-muted-foreground"> / {c.exampleZh}</span> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Owner tools */}
      {canEdit ? (
        <div className="space-y-3 border-t border-border/60 pt-4">
          <h2 className="text-sm font-semibold text-muted-foreground">{t('bank.manage')}</h2>
          <EditSetForm
            setId={set.id}
            name={set.name}
            chunksText={serializeChunks(set.chunks)}
            meta={{ cefr: set.cefr, strand: set.strand, domain: set.domain, tags: set.tags, source: set.source }}
          />
          <VideoUpload chunkSetId={set.id} hasVideo={Boolean(set.shadowVideoKey)} />
          <form action={deleteChunkSet}>
            <input type="hidden" name="chunkSetId" value={set.id} />
            <SubmitButton variant="outline" size="sm" className="text-destructive">{t('bank.delete')}</SubmitButton>
          </form>
        </div>
      ) : null}
    </div>
  )
}
