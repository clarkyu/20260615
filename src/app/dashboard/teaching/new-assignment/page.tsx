import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileStack, Trash2 } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as offeringRepo from '@/lib/repo/offerings'
import * as templateRepo from '@/lib/repo/templates'
import * as bankRepo from '@/lib/repo/bank'
import { parseTemplatePayload } from '@/lib/assignment-template'
import { parseChoices } from '@/lib/choices'
import { deleteAssignmentTemplate } from '@/actions/assignments'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AssignmentForm, type AssignmentInitial } from '@/components/assignment-form'

export default async function NewAssignmentDirectPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const { template } = await searchParams
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  // All of the teacher's offerings — the assignment can be published to any of them.
  const offerings = await offeringRepo.listForStaff(prisma, user.schoolId, user.userId, user.role)

  if (offerings.length === 0) {
    return (
      <div className="space-y-4 py-2">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
            {t('asg.noOfferingFirst')}
            <Link href="/dashboard/teaching/new">
              <Button size="sm">{t('teach.new')}</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const nameCounts = new Map<string, number>()
  for (const o of offerings) nameCounts.set(o.class.name, (nameCounts.get(o.class.name) ?? 0) + 1)
  const targets = offerings.map((o) => ({
    offeringId: o.id,
    label: (nameCounts.get(o.class.name) ?? 0) > 1 ? `${o.class.name} · ${o.course.name}` : o.class.name,
  }))

  // Prefill from a chosen template (the publish form opens in create mode, editable).
  const templates = await templateRepo.listVisible(prisma, user.schoolId)
  let initial: AssignmentInitial | undefined
  const tmplId = Number(template)
  if (Number.isInteger(tmplId) && tmplId > 0) {
    const tmpl = await templateRepo.findVisible(prisma, tmplId, user.schoolId)
    const payload = tmpl ? parseTemplatePayload(tmpl.payload) : null
    if (payload) {
      const bank = payload.chunkSetId ? await bankRepo.findSummaryVisible(prisma, payload.chunkSetId, user.schoolId) : null
      initial = {
        // no id → create mode, just prefilled
        title: payload.title,
        monthLabel: payload.monthLabel,
        chunkSetId: bank?.id ?? null,
        chunkSetName: bank?.name ?? null,
        chunkSetCount: bank?._count.chunks ?? 0,
        chunkSetHasVideo: Boolean(bank?.shadowVideoKey),
        phases: payload.phases.map((p) => ({
          title: p.title,
          category: p.category,
          instructions: p.instructions,
          useBankSet: p.useBankSet,
          sentences: p.sentences,
          openAt: '',
          dueAt: '',
          requireEyesClosed: p.requireEyesClosed,
          requireText: p.requireText,
          requireAudio: p.requireAudio,
          requireVideo: p.requireVideo,
          requireHandwriting: p.requireHandwriting,
          requireChoice: p.requireChoice,
          choices: parseChoices(p.choicesJson),
          correctIndex: p.correctChoice ? parseChoices(p.choicesJson).indexOf(p.correctChoice) : -1,
          requireFreeText: p.requireFreeText,
          rubric: p.rubric ?? '',
          perceptionModel: p.perceptionModel ?? '',
          judgeModel: p.judgeModel ?? '',
          graded: p.graded,
          maxAttempts: p.maxAttempts,
          isFormalTest: p.isFormalTest,
          freePractice: p.freePractice,
        })),
      }
    }
  }

  return (
    <div className="space-y-4 py-2">
      {templates.length > 0 ? (
        <details className="rounded-xl border border-input" open={!initial}>
          <summary className="tap flex cursor-pointer items-center gap-2 p-3 text-sm font-medium">
            <FileStack className="h-4 w-4 text-primary" />{t('tmpl.pick')}
            <span className="text-muted-foreground">{templates.length}</span>
          </summary>
          <div className="space-y-2 border-t border-border/60 p-3">
            {templates.map((tm) => (
              <div key={tm.id} className="flex items-center gap-2 rounded-lg border border-border/70 p-2.5 text-sm">
                <Link href={`/dashboard/teaching/new-assignment?template=${tm.id}`} className="min-w-0 flex-1">
                  <div className="truncate font-medium">{tm.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {tm.schoolId == null ? <Badge tone="primary">{t('bank.official')}</Badge> : null}
                    {tm.createdBy?.name ? <span className="truncate">{tm.createdBy.name}</span> : null}
                  </div>
                </Link>
                {tm.schoolId != null ? (
                  <form action={deleteAssignmentTemplate}>
                    <input type="hidden" name="templateId" value={tm.id} />
                    <button type="submit" aria-label={t('tmpl.delete')} className="tap rounded-lg p-1.5 text-destructive hover:bg-destructive/10">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {initial ? (
        <p className="rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 text-sm">
          {t('tmpl.applied', { name: initial.title })}
        </p>
      ) : null}

      <AssignmentForm targets={targets} initial={initial} />
    </div>
  )
}
