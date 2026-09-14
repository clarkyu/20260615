import Link from 'next/link'
import { asc, count, eq } from 'drizzle-orm'
import { requireTeacherPage } from '@/lib/auth/teacher'
import { getDb } from '@/lib/db/client'
import { items, papers } from '@/lib/db/schema'
import { PaperStatus } from '@/components/teacher/PaperStatus'

export const dynamic = 'force-dynamic'

// 试卷列表(SPEC §8 题库管理入口):按年份排,显示状态与小题数;点进去看整卷(含答案)。
export default async function TeacherPapers() {
  await requireTeacherPage()
  const db = getDb()
  const rows = await db
    .select({
      id: papers.id,
      title: papers.title,
      year: papers.year,
      region: papers.region,
      status: papers.status,
      totalScore: papers.totalScore,
      durationMinutes: papers.durationMinutes,
      updatedAt: papers.updatedAt,
      nItems: count(items.id),
    })
    .from(papers)
    .leftJoin(items, eq(items.paperId, papers.id))
    .groupBy(papers.id)
    .orderBy(asc(papers.year), asc(papers.title))
  return (
    <main>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">试卷</h1>
          <p className="mt-1 text-sm text-neutral-500">学生在「自由练习」里只看得到「已发布」的试卷；任务作答不受此限。</p>
        </div>
        <Link href="/teacher/import" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white">
          导入 Word 试卷
        </Link>
      </div>
      <table className="mt-4 w-full border-collapse overflow-hidden rounded-2xl border border-neutral-200 bg-white text-sm dark:border-neutral-800 dark:bg-neutral-900">
        <thead className="bg-neutral-100 text-left dark:bg-neutral-800">
          <tr>
            <th className="p-3">试卷</th>
            <th className="p-3">年份 / 地区</th>
            <th className="p-3">小题</th>
            <th className="p-3">满分 / 时长</th>
            <th className="p-3">状态</th>
            <th className="p-3">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-t border-neutral-200 dark:border-neutral-800">
              <td className="p-3 font-medium">{p.title}</td>
              <td className="p-3">
                {p.year} · {p.region}
              </td>
              <td className="p-3">{p.nItems}</td>
              <td className="p-3">
                {p.totalScore} 分 · {p.durationMinutes} 分钟
              </td>
              <td className="p-3">
                <PaperStatus paperId={p.id} status={p.status} />
              </td>
              <td className="p-3">
                <Link href={`/teacher/papers/${p.id}`} className="text-blue-600 hover:underline">
                  查看整卷
                </Link>
                <span className="mx-2 text-neutral-300">|</span>
                <Link href={`/teacher/assignments?paperId=${encodeURIComponent(p.id)}`} className="text-blue-600 hover:underline">
                  发布任务
                </Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td className="p-6 text-center text-neutral-400" colSpan={6}>
                还没有试卷，先去「导入」上传 Word 真题。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </main>
  )
}
