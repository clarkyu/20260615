import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft, Eye, Video, PenLine, Mic, Camera, ListChecks } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as assignmentRepo from '@/lib/repo/assignments'
import { presignDownload, storageConfigured } from '@/lib/storage'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

const fmt = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ')

// Read-only "preview as student": shows a teacher exactly the content + structure a
// student receives for this assignment, without touching the live submission flow.
export default async function AssignmentPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assignmentId = Number(id)
  if (!Number.isInteger(assignmentId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const a = await assignmentRepo.findForStaffPreview(prisma, assignmentId, user.schoolId)
  if (!a) notFound()

  const now = new Date()
  const notOpen = a.openAt ? now < a.openAt : false
  const closed = a.dueAt ? now > a.dueAt : false
  const windowLabel = notOpen ? t('sub.notOpen') : closed ? t('sub.closed') : t('preview.open')
  const isShadow = Boolean(a.shadowVideoKey && a.chunkSet)
  const videoUrl = a.shadowVideoKey && storageConfigured() ? await presignDownload(a.shadowVideoKey) : null

  const kinds = [
    a.requireText ? { icon: PenLine, label: t('asg.kindText') } : null,
    a.requireVideo ? { icon: Video, label: t('asg.kindVideo') } : null,
    a.requireAudio ? { icon: Mic, label: t('asg.kindAudio') } : null,
    a.requireHandwriting ? { icon: Camera, label: t('asg.kindHandwriting') } : null,
  ].filter((k): k is { icon: typeof PenLine; label: string } => k !== null)

  return (
    <div className="space-y-4 py-2">
      <Link href={`/dashboard/assignments/${a.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{t('back')}
      </Link>

      <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 text-sm">
        <Eye className="h-4 w-4 shrink-0 text-primary" />
        <span className="font-medium">{t('preview.banner')}</span>
      </div>

      <div className="space-y-2">
        {a.category ? <Badge tone="primary">{a.category}</Badge> : null}
        <h1 className="text-2xl font-bold tracking-tight">{a.title}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <Badge tone={notOpen || closed ? undefined : 'success'}>{windowLabel}</Badge>
          {a.openAt ? <span>{t('preview.opensAt')} {fmt(a.openAt)}</span> : null}
          {a.dueAt ? <span>{t('asg.due')} {fmt(a.dueAt)}</span> : null}
          <span>{t('asg.fAttempts')}: {a.maxAttempts}</span>
        </div>
      </div>

      {a.instructions ? (
        <Card><CardContent className="whitespace-pre-line p-4 text-sm">{a.instructions}</CardContent></Card>
      ) : null}

      {videoUrl ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><Video className="h-4 w-4 text-primary" />{t('shadow.title')}</div>
            <video src={videoUrl} controls playsInline preload="metadata" className="max-h-[60vh] w-full rounded-xl bg-black" />
          </CardContent>
        </Card>
      ) : null}

      {/* Shadowing chunks (the per-sentence content students shadow) */}
      {isShadow && a.chunkSet ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{t('preview.sentences')}</h2>
          <Card>
            <CardContent className="divide-y divide-border/60 p-0">
              {a.chunkSet.chunks.map((c) => (
                <div key={c.id} className="flex gap-3 p-3.5 text-sm">
                  <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{c.order}</span>
                  <div className="min-w-0 space-y-1">
                    <div className="font-semibold">{c.exampleEn || c.english}</div>
                    {c.exampleZh || c.chinese ? <div className="text-xs text-muted-foreground">{c.exampleZh || c.chinese}</div> : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : a.sentences.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{t('preview.sentences')}</h2>
          <Card>
            <CardContent className="divide-y divide-border/60 p-0">
              {a.sentences.map((s) => (
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
        </div>
      ) : null}

      {/* What students submit */}
      {!isShadow && kinds.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{t('preview.submitKinds')}</h2>
          <div className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <span key={k.label} className="inline-flex items-center gap-1.5 rounded-xl border border-input px-3 py-1.5 text-sm">
                <k.icon className="h-4 w-4 text-muted-foreground" />{k.label}
              </span>
            ))}
            {a.requireEyesClosed && a.requireVideo ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-input px-3 py-1.5 text-sm">
                <Eye className="h-4 w-4 text-muted-foreground" />{t('asg.fEyes')}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5" />{t('preview.studentArea')}
      </p>
    </div>
  )
}
