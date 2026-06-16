import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { deleteChunkSet } from '@/actions/bank'
import { VideoUpload } from './video-upload'

export default async function ChunkSetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const setId = Number(id)
  if (!Number.isInteger(setId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const set = await prisma.chunkSet.findFirst({
    where: { id: setId, schoolId: user.schoolId },
    include: { chunks: { orderBy: { order: 'asc' } } },
  })
  if (!set) notFound()

  return (
    <div className="space-y-4 py-2">
      <Link href="/dashboard/bank" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{t('bank.title')}
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{set.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{set.chunks.length} {t('bank.chunkUnit')}</p>
      </div>

      <VideoUpload chunkSetId={set.id} hasVideo={Boolean(set.shadowVideoKey)} />

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

      <form action={deleteChunkSet} className="pt-2">
        <input type="hidden" name="chunkSetId" value={set.id} />
        <Button type="submit" variant="outline" size="sm" className="text-destructive">{t('bank.delete')}</Button>
      </form>
    </div>
  )
}
