import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { requireTeacherPage } from '@/lib/auth/teacher'
import { getDb } from '@/lib/db/client'
import { assignments, classes, papers } from '@/lib/db/schema'
import { assignmentRoster, parseSettings } from '@/lib/db/assignments'
import { ReleaseButton } from '@/components/teacher/ReleaseButtons'
import { ATTEMPT_STATUS_LABEL, fmtTime, MODE_LABEL } from '@/lib/teacher/item-preview'

export const dynamic = 'force-dynamic'

// 任务详情:设置摘要 + 名单(每人最近一次作答状态 / 分数)+ 发布成绩(整任务或单份)。
export default async function TeacherAssignmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireTeacherPage()
  const { id } = await params
  const db = getDb()
  const row = await db
    .select({ a: assignments, className: classes.name, paperTitle: papers.title, paperTotal: papers.totalScore })
    .from(assignments)
    .innerJoin(classes, eq(assignments.classId, classes.id))
    .leftJoin(papers, eq(assignments.paperId, papers.id))
    .where(and(eq(assignments.id, id), eq(classes.teacherId, userId)))
    .limit(1)
  const found = row[0]
  if (!found) notFound()
  const a = found.a
  const settings = parseSettings(a.settings)
  const roster = await assignmentRoster(db, a)
  const submitted = roster.filter((r) => r.status !== 'not_started' && r.status !== 'in_progress')
  const releasable = roster.filter((r) => r.status === 'submitted' || r.status === 'graded').length
  const scores = submitted.map((r) => r.totalScore).filter((x): x is number => typeof x === 'number')
  const avg = scores.length ? (scores.reduce((s, x) => s + x, 0) / scores.length).toFixed(1) : '—'
  return (
    <main>
      <p className="text-sm">
        <Link href="/teacher/assignments" className="text-blue-600 hover:underline">
          ← 任务
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{a.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {found.className} · {found.paperTitle ?? '—'}
            {a.itemIds?.length ? `（勾选 ${a.itemIds.length} 题）` : '（整卷）'} · {MODE_LABEL[a.mode] ?? a.mode}
            {a.mode === 'exam' && a.durationMinutes ? ` ${a.durationMinutes} 分钟` : ''}
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            开放 {fmtTime(a.opensAt)} → 截止 {fmtTime(a.dueAt)} · 解析{settings.showExplanation ? '可见' : '隐藏'} · 成绩{settings.release === 'on_submit' ? '交卷即发布' : '手动发布'}
            {a.mode === 'exam' ? ` · ${settings.allowRetake ? '允许重考' : '不可重考'}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ReleaseButton kind="assignment" id={a.id} label={`发布成绩（${releasable} 份待发布）`} />
          <Link href={`/teacher/stats?assignmentId=${a.id}`} className="text-sm text-blue-600 hover:underline">
            看学情 / 导出 CSV
          </Link>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['班级人数', roster.length],
          ['已交卷', submitted.length],
          ['平均分', avg],
          ['待发布', releasable],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-xs text-neutral-500">{k}</p>
            <p className="text-2xl font-bold">{v}</p>
          </div>
        ))}
      </div>
      <table className="mt-4 w-full border-collapse overflow-hidden rounded-2xl border border-neutral-200 bg-white text-sm dark:border-neutral-800 dark:bg-neutral-900">
        <thead className="bg-neutral-100 text-left dark:bg-neutral-800">
          <tr>
            <th className="p-3">学生</th>
            <th className="p-3">状态</th>
            <th className="p-3">分数</th>
            <th className="p-3">交卷时间</th>
            <th className="p-3">操作</th>
          </tr>
        </thead>
        <tbody>
          {roster.map((r) => (
            <tr key={r.userId} className="border-t border-neutral-200 dark:border-neutral-800">
              <td className="p-3">{r.name}</td>
              <td className="p-3">{ATTEMPT_STATUS_LABEL[r.status] ?? r.status}</td>
              <td className="p-3">{typeof r.totalScore === 'number' ? r.totalScore : '—'}</td>
              <td className="p-3 text-neutral-500">{fmtTime(r.submittedAt)}</td>
              <td className="p-3">
                {r.attemptId && (r.status === 'submitted' || r.status === 'graded') ? <ReleaseButton kind="attempt" id={r.attemptId} label="发布" small /> : null}
                {r.attemptId ? (
                  <Link href={`/teacher/grading?attemptId=${r.attemptId}`} className="ml-2 text-xs text-blue-600 hover:underline">
                    批改
                  </Link>
                ) : null}
              </td>
            </tr>
          ))}
          {roster.length === 0 ? (
            <tr>
              <td className="p-6 text-center text-neutral-400" colSpan={5}>
                班级里还没有学生。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </main>
  )
}
