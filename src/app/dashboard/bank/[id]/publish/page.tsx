import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { serializeChunks } from '@/lib/bank'
import * as bankRepo from '@/lib/repo/bank'
import * as offeringRepo from '@/lib/repo/offerings'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AssignmentForm } from '@/components/assignment-form'
import { EditSetForm } from '../edit-set-form'

export default async function PublishFromSetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const setId = Number(id)
  if (!Number.isInteger(setId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const set = await bankRepo.findWithChunksVisible(prisma, setId, user.schoolId)
  if (!set) notFound()

  // Same edit policy as the set page: own a school set, or be super-admin for a global
  // (official) one. Lets the teacher fix a typo inline before publishing instead of
  // bouncing back to the set page. Editing writes back to the shared set (no per-publish
  // copy), which matches the existing single-source model.
  const isGlobal = set.schoolId === null
  const canEdit = isGlobal ? user.role === 'SUPER_ADMIN' : set.schoolId === user.schoolId

  const offerings = await offeringRepo.listForStaff(prisma, user.schoolId, user.userId, user.role)

  if (offerings.length === 0) {
    return (
      <div className="space-y-4 py-2">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
            {t('asg.noOfferingFirst')}
            <Link href="/dashboard/teaching/new"><Button size="sm">{t('teach.new')}</Button></Link>
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

  return (
    <div className="space-y-3 py-2">
      <Link href={`/dashboard/bank/${set.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{set.name}
      </Link>
      {canEdit ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t('bank.editBeforePublish')}</p>
          <EditSetForm
            setId={set.id}
            name={set.name}
            chunksText={serializeChunks(set.chunks)}
            meta={{ cefr: set.cefr, strand: set.strand, domain: set.domain, tags: set.tags, source: set.source }}
          />
        </div>
      ) : null}
      <AssignmentForm
        targets={targets}
        chunkSet={{ id: set.id, name: set.name, count: set.chunks.length, hasVideo: Boolean(set.shadowVideoKey) }}
      />
    </div>
  )
}
