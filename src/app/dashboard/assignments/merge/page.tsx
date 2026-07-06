import { GitMerge } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import type { Metadata } from 'next'
import { getT } from '@/lib/i18n-server'
import * as assignmentRepo from '@/lib/repo/assignments'
import { groupAssignmentBatches } from '@/lib/assignment-batches'
import { Card, CardContent } from '@/components/ui/card'
import { MergeForm } from './merge-form'

// 归并批次:老师把误分开发布的同课程作业(每班发了一次 → 列表里 N 张卡)合并为一个
// 发布批次 + 统一标题,列表随即合成一张按班级展开的卡。选择/预填在客户端表单里做,
// 这页只做鉴权 + 取当前分组喂给它。
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('asgList.merge') }
}

export default async function MergeBatchesPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()

  const groups = user.schoolId
    ? await (async () => {
        const list = await assignmentRepo.listForStaff(prisma, user.schoolId, user.userId, user.role)
        return groupAssignmentBatches(
          list.map((a) => ({
            id: a.id, title: a.title, category: a.category, dueAt: a.dueAt, batchId: a.batchId,
            phaseCount: a._count.phases, courseId: a.offering.courseId, courseName: a.offering.course.name, className: a.offering.class.name,
          })),
          new Map(),
          new Map(),
        )
      })()
    : []

  return (
    <div className="space-y-4 py-2">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <GitMerge className="h-6 w-6 text-primary" />{t('asgList.merge')}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('merge.subtitle')}</p>
      </div>

      {groups.length < 2 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">{t('merge.empty')}</CardContent>
        </Card>
      ) : (
        <MergeForm
          groups={groups.map((g) => ({
            key: g.key,
            title: g.title,
            courseId: g.courseId,
            courseName: g.courseName,
            classNames: g.classes.map((c) => c.className),
            assignmentIds: g.classes.map((c) => c.assignmentId),
          }))}
        />
      )}
    </div>
  )
}
