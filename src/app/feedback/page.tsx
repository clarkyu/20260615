import { redirect } from 'next/navigation'
import { MessageSquarePlus, Star } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import type { Metadata } from 'next'
import { getT } from '@/lib/i18n-server'
import * as feedbackRepo from '@/lib/repo/feedback'
import { feedbackPointsTotal } from '@/lib/domain/points'
import { reviewFeedback } from '@/actions/feedback'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FeedbackForm } from './feedback-form'

const STATUS_TONE = { ADOPTED: 'success', DECLINED: 'muted', PENDING: 'warning' } as const
const STATUS_KEY = { ADOPTED: 'fb.adopted', DECLINED: 'fb.declined', PENDING: 'fb.pending' } as const

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('nav.feedback') }
}

export default async function FeedbackPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const prisma = await getDb()
  const { t } = await getT()

  const isAdmin = user.role === 'SUPER_ADMIN'
  const [mine, points, queue] = await Promise.all([
    feedbackRepo.listForUser(prisma, user.userId),
    feedbackRepo.pointsForUser(prisma, user.userId),
    isAdmin ? feedbackRepo.listAllForReview(prisma) : Promise.resolve([]),
  ])
  const day = (d: Date) => d.toISOString().slice(0, 10)

  return (
    <div className="space-y-4 py-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('fb.title')}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('fb.subtitle')}</p>
      </div>

      {/* Points summary — derived: submissions×10 + adopted×100 */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Star className="h-4 w-4 text-primary" />{t('fb.myPoints')}
            </span>
            <span className="text-2xl font-extrabold tabular-nums text-primary">
              {feedbackPointsTotal(points)}
              <span className="ml-1 text-xs font-medium text-muted-foreground">{t('fb.pointsUnit')}</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{t('fb.submittedN', { n: points.submitted })}</span>
            <span>{t('fb.adoptedN', { n: points.adopted })}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">{t('fb.rule')}</p>
        </CardContent>
      </Card>

      <FeedbackForm />

      {/* My own submissions */}
      <section className="space-y-2">
        <h2 className="px-1 text-sm font-semibold text-muted-foreground">{t('fb.mine')}</h2>
        {mine.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <MessageSquarePlus className="h-7 w-7 opacity-50" />
              {t('fb.empty')}
            </CardContent>
          </Card>
        ) : (
          mine.map((f) => {
            const s = (f.status as keyof typeof STATUS_TONE) ?? 'PENDING'
            return (
              <Card key={f.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 whitespace-pre-wrap text-sm leading-relaxed">{f.body}</p>
                    <Badge tone={STATUS_TONE[s]}>{t(STATUS_KEY[s])}</Badge>
                  </div>
                  {f.reply ? (
                    <div className="rounded-xl bg-secondary p-3 text-xs leading-relaxed">
                      <span className="font-semibold">{t('fb.reply')}：</span>
                      <span className="text-muted-foreground">{f.reply}</span>
                    </div>
                  ) : null}
                  <p className="text-[11px] text-muted-foreground">{day(f.createdAt)}</p>
                </CardContent>
              </Card>
            )
          })
        )}
      </section>

      {/* Super-admin review queue */}
      {isAdmin ? (
        <section className="space-y-2">
          <h2 className="px-1 text-sm font-semibold text-muted-foreground">{t('fb.review')}</h2>
          {queue.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">{t('fb.reviewEmpty')}</CardContent>
            </Card>
          ) : (
            queue.map((f) => {
              const s = (f.status as keyof typeof STATUS_TONE) ?? 'PENDING'
              const who = f.user.name || f.user.studentNo || f.user.staffNo || '—'
              return (
                <Card key={f.id}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 whitespace-pre-wrap text-sm leading-relaxed">{f.body}</p>
                      <Badge tone={STATUS_TONE[s]}>{t(STATUS_KEY[s])}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {who}{f.user.school ? ` · ${f.user.school.name}` : ''} · {day(f.createdAt)}
                    </p>
                    <form action={reviewFeedback} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="feedbackId" value={f.id} />
                      <Input name="reply" defaultValue={f.reply ?? ''} placeholder={t('fb.replyPh')} aria-label={t('fb.replyPh')} className="min-w-[10rem] flex-1" />
                      <Button type="submit" name="action" value="adopt" size="sm" variant="default">{t('fb.adopt')}</Button>
                      <Button type="submit" name="action" value="decline" size="sm" variant="outline">{t('fb.decline')}</Button>
                      {s !== 'PENDING' ? (
                        <Button type="submit" name="action" value="reset" size="sm" variant="ghost">{t('fb.reset')}</Button>
                      ) : null}
                    </form>
                  </CardContent>
                </Card>
              )
            })
          )}
        </section>
      ) : null}
    </div>
  )
}
