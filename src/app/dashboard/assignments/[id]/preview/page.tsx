import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft, Eye, Video, PenLine, Mic, Camera, ListChecks } from 'lucide-react'
import type { Prisma } from '@prisma/client'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as assignmentRepo from '@/lib/repo/assignments'
import { presignDownload, storageConfigured } from '@/lib/storage'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { BilingualChunkList } from '@/components/bilingual'

const fmt = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ')

type PhasePreview = Prisma.PhaseGetPayload<{
  include: { sentences: { orderBy: { order: 'asc' } }; chunkSet: { include: { chunks: { orderBy: { order: 'asc' } } } } }
}>

// One phase's read-only preview — mirrors what the student receives for that phase.
async function PhaseSection({ phase, single, index }: { phase: PhasePreview; single: boolean; index: number }) {
  const { t } = await getT()
  const now = new Date()
  const notOpen = phase.openAt ? now < phase.openAt : false
  const closed = phase.dueAt ? now > phase.dueAt : false
  const windowLabel = notOpen ? t('sub.notOpen') : closed ? t('sub.closed') : t('preview.open')
  // Matches the student routing: per-sentence shadowing only when bank video + NOT eyes-closed.
  const isShadow = Boolean(phase.shadowVideoKey && phase.chunkSet && !phase.requireEyesClosed)
  const videoUrl = phase.shadowVideoKey && storageConfigured() ? await presignDownload(phase.shadowVideoKey) : null

  const kinds = [
    phase.requireText ? { icon: PenLine, label: t('asg.kindText') } : null,
    phase.requireVideo ? { icon: Video, label: t('asg.kindVideo') } : null,
    phase.requireAudio ? { icon: Mic, label: t('asg.kindAudio') } : null,
    phase.requireHandwriting ? { icon: Camera, label: t('asg.kindHandwriting') } : null,
  ].filter((k): k is { icon: typeof PenLine; label: string } => k !== null)

  return (
    <div className="space-y-3">
      {!single ? (
        <div className="flex items-center gap-2 border-t border-border/60 pt-3">
          <span className="text-sm font-bold">{phase.title?.trim() || t('phase.nth', { n: index + 1 })}</span>
          {!phase.graded ? <Badge>{t('phase.practiceOnly')}</Badge> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <Badge tone={notOpen || closed ? undefined : 'success'}>{windowLabel}</Badge>
        {phase.openAt ? <span>{t('preview.opensAt')} {fmt(phase.openAt)}</span> : null}
        {phase.dueAt ? <span>{t('asg.due')} {fmt(phase.dueAt)}</span> : null}
        <span>{t('asg.fAttempts')}: {phase.maxAttempts}</span>
      </div>

      {phase.instructions ? <Card><CardContent className="whitespace-pre-line p-4 text-sm">{phase.instructions}</CardContent></Card> : null}

      {videoUrl ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><Video className="h-4 w-4 text-primary" />{t('shadow.title')}</div>
            <video src={videoUrl} controls playsInline preload="metadata" className="max-h-[60vh] w-full rounded-xl bg-black" />
          </CardContent>
        </Card>
      ) : null}

      {isShadow && phase.chunkSet ? (
        <BilingualChunkList chunks={phase.chunkSet.chunks} title={t('preview.sentences')} />
      ) : phase.sentences.length > 0 ? (
        <Card>
          <CardContent className="divide-y divide-border/60 p-0">
            {phase.sentences.map((s) => (
              <div key={s.id} className="flex gap-3 p-3.5 text-sm">
                <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{s.order}</span>
                <div className="min-w-0 space-y-1">
                  <div className="font-medium">{s.text}</div>
                  {s.translation ? <div className="text-xs text-muted-foreground">{s.translation}</div> : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {!isShadow && kinds.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <span key={k.label} className="inline-flex items-center gap-1.5 rounded-xl border border-input px-3 py-1.5 text-sm">
              <k.icon className="h-4 w-4 text-muted-foreground" />{k.label}
            </span>
          ))}
          {phase.requireEyesClosed && phase.requireVideo ? (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-input px-3 py-1.5 text-sm">
              <Eye className="h-4 w-4 text-muted-foreground" />{t('asg.fEyes')}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// Read-only "preview as student": shows a teacher exactly the content + structure a
// student receives — every phase — without touching the live submission flow.
export default async function AssignmentPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assignmentId = Number(id)
  if (!Number.isInteger(assignmentId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const a = await assignmentRepo.findForStaffPreviewPhases(prisma, assignmentId, user.schoolId)
  if (!a) notFound()
  const single = a.phases.length === 1

  return (
    <div className="space-y-4 py-2">
      <Link href={`/dashboard/assignments/${a.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{t('back')}
      </Link>

      <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 text-sm">
        <Eye className="h-4 w-4 shrink-0 text-primary" />
        <span className="font-medium">{t('preview.banner')}</span>
      </div>

      <div className="space-y-1">
        {a.category ? <Badge tone="primary">{a.category}</Badge> : null}
        <h1 className="text-2xl font-bold tracking-tight">{a.title}</h1>
        {!single ? <p className="text-sm text-muted-foreground">{a.phases.length} {t('phase.unit')}</p> : null}
      </div>

      {a.phases.map((p, i) => (
        <PhaseSection key={p.id} phase={p} single={single} index={i} />
      ))}

      <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5" />{t('preview.studentArea')}
      </p>
    </div>
  )
}
