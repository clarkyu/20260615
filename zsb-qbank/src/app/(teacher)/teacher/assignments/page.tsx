import Link from 'next/link'
import { asc, desc, eq } from 'drizzle-orm'
import { requireTeacherPage } from '@/lib/auth/teacher'
import { getDb } from '@/lib/db/client'
import { assignments, classes, papers } from '@/lib/db/schema'
import { assignmentProgress, classMemberCount } from '@/lib/db/assignments'
import { AssignmentForm } from '@/components/teacher/AssignmentForm'
import { fmtTime, MODE_LABEL } from '@/lib/teacher/item-preview'

export const dynamic = 'force-dynamic'

// 任务(SPEC §8):发布表单 + 我发布的任务列表(班级、试卷、模式、时间、进度)。
// ?paperId= / ?classId= 预选(从试卷页 / 班级页跳来)。
export default async function TeacherAssignments({ searchParams }: { searchParams: Promise<{ paperId?: string; classId?: string }> }) {
  const { userId } = await requireTeacherPage()
  const sp = await searchParams
  const db = getDb()
  const paperRows = await db
    .select({ id: papers.id, title: papers.title, durationMinutes: papers.durationMinutes, totalScore: papers.totalScore })
    .from(papers)
    .orderBy(desc(papers.year), asc(papers.title))
  const classRows = await db.select({ id: classes.id, name: classes.name }).from(classes).where(eq(classes.teacherId, userId)).orderBy(asc(classes.createdAt))
  const members = await classMemberCount(db, classRows.map((c) => c.id))
  const rows = await db
    .select({ a: assignments, className: classes.name, paperTitle: papers.title })
    .from(assignments)
    .innerJoin(classes, eq(assignments.classId, classes.id))
    .leftJoin(papers, eq(assignments.paperId, papers.id))
    .where(eq(classes.teacherId, userId))
    .orderBy(desc(assignments.createdAt))
  const progress = await assignmentProgress(db, rows.map((r) => r.a.id))

  return (
    <main>
      <h1 className="text-2xl font-bold">任务</h1>
      <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-3 font-semibold">发布新任务</h2>
        <AssignmentForm papers={paperRows} classes={classRows.map((c) => ({ ...c, members: members.get(c.id) ?? 0 }))} initialPaperId={sp.paperId} initialClassId={sp.classId} />
      </section>
      <table className="mt-6 w-full border-collapse overflow-hidden rounded-2xl border border-neutral-200 bg-white text-sm dark:border-neutral-800 dark:bg-neutral-900">
        <thead className="bg-neutral-100 text-left dark:bg-neutral-800">
          <tr>
            <th className="p-3">任务</th>
            <th className="p-3">班级</th>
            <th className="p-3">试卷 / 范围</th>
            <th className="p-3">模式</th>
            <th className="p-3">开放 → 截止</th>
            <th className="p-3">进度</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ a, className, paperTitle }) => {
            const p = progress.get(a.id)
            const n = members.get(a.classId) ?? 0
            return (
              <tr key={a.id} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="p-3 font-medium">
                  <Link href={`/teacher/assignments/${a.id}`} className="text-blue-600 hover:underline">
                    {a.title}
                  </Link>
                </td>
                <td className="p-3">{className}</td>
                <td className="p-3">
                  {paperTitle ?? '—'}
                  <span className="ml-1 text-neutral-400">{a.itemIds?.length ? `（${a.itemIds.length} 题）` : '（整卷）'}</span>
                </td>
                <td className="p-3">
                  {MODE_LABEL[a.mode] ?? a.mode}
                  {a.mode === 'exam' && a.durationMinutes ? <span className="text-neutral-400"> · {a.durationMinutes} 分钟</span> : null}
                </td>
                <td className="p-3 text-neutral-500">
                  {fmtTime(a.opensAt)} → {fmtTime(a.dueAt)}
                </td>
                <td className="p-3">
                  已交 {p?.submitted ?? 0} / 开始 {p?.started ?? 0} / 共 {n}
                </td>
              </tr>
            )
          })}
          {rows.length === 0 ? (
            <tr>
              <td className="p-6 text-center text-neutral-400" colSpan={6}>
                还没有任务。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </main>
  )
}
