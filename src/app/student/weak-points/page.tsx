import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft, Target, ChevronRight, Sparkles } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as userRepo from '@/lib/repo/users'
import * as submissionRepo from '@/lib/repo/submissions'
import * as assignmentRepo from '@/lib/repo/assignments'
import { latestPhaseSubmissions, studentWeakPoints } from '@/lib/domain/analytics'
import { Card, CardContent } from '@/components/ui/card'

// 我的薄弱点：把学生自己历次评分里反复出错的句子沉淀成个人画像，并直达对应环节练习。
export default async function WeakPointsPage() {
  const user = await requireRole('STUDENT')
  const prisma = await getDb()
  const { t } = await getT()
  const me = await userRepo.findById(prisma, user.userId)
  if (me?.mustChangePassword) redirect('/student/change-password')

  const rows = await submissionRepo.listForStudentLatestFirst(prisma, user.userId)
  const phaseSubs = latestPhaseSubmissions(rows)
  const titleById = new Map(rows.map((r) => [r.assignmentId, r.assignment?.title ?? '']))
  const assignmentIds = [...new Set(phaseSubs.map((s) => s.assignmentId))]
  const sentences = await assignmentRepo.listSentencesForAssignments(prisma, assignmentIds)
  const weak = studentWeakPoints(phaseSubs, sentences)

  return (
    <div className="space-y-4 py-2">
      <Link href="/student" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{t('back')}
      </Link>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Target className="h-6 w-6 text-primary" />{t('weak.title')}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('weak.subtitle')}</p>
      </div>

      {weak.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Sparkles className="h-8 w-8 text-success/70" />
            {t('weak.empty')}
          </CardContent>
        </Card>
      ) : (
        <ol className="space-y-2.5">
          {weak.map((w) => {
            const href = w.phaseId
              ? `/student/assignments/${w.assignmentId}/phase/${w.phaseId}`
              : `/student/assignments/${w.assignmentId}`
            const pct = Math.round(w.avgAccuracy * 100)
            return (
              <li key={`${w.assignmentId}:${w.phaseId ?? 0}:${w.order}`}>
                <Link href={href}>
                  <Card className="tap hover:shadow-card">
                    <CardContent className="flex items-center gap-3 p-3.5">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-snug">{w.text}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {titleById.get(w.assignmentId) || ''} · {t('weak.acc', { n: pct })} · {t('weak.samples', { n: w.samples })}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-primary">{t('weak.practice')}</span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                    </CardContent>
                  </Card>
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
