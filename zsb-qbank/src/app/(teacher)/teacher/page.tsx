import Link from 'next/link'
import { count, eq } from 'drizzle-orm'
import { requireTeacherPage } from '@/lib/auth/teacher'
import { getDb } from '@/lib/db/client'
import { assignments, classes, papers, responses } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

// 教师端概览:四个数字 + 入口。
export default async function TeacherHome() {
  const { user, userId } = await requireTeacherPage()
  const db = getDb()
  const [nPapers] = await db.select({ n: count() }).from(papers)
  const [nClasses] = await db.select({ n: count() }).from(classes).where(eq(classes.teacherId, userId))
  const [nAssignments] = await db.select({ n: count() }).from(assignments).where(eq(assignments.createdBy, userId))
  const [nReview] = await db.select({ n: count() }).from(responses).where(eq(responses.needsReview, true))
  const cards: Array<[string, number, string, string]> = [
    ['试卷', nPapers?.n ?? 0, '/teacher/papers', '题库中的试卷'],
    ['班级', nClasses?.n ?? 0, '/teacher/classes', '我的班级与加入码'],
    ['任务', nAssignments?.n ?? 0, '/teacher/assignments', '已发布的任务'],
    ['待复核', nReview?.n ?? 0, '/teacher/grading', '等老师改分的作答'],
  ]
  return (
    <main>
      <h1 className="text-2xl font-bold">你好，{user.name}</h1>
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map(([label, n, href, desc]) => (
          <Link key={href} href={href} className="rounded-2xl border border-neutral-200 bg-white p-4 hover:border-blue-400 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-sm text-neutral-500">{label}</p>
            <p className="mt-1 text-3xl font-bold">{n}</p>
            <p className="mt-1 text-xs text-neutral-400">{desc}</p>
          </Link>
        ))}
      </div>
      <div className="mt-8 rounded-2xl border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
        <p className="font-medium">上课流程</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-neutral-600 dark:text-neutral-300">
          <li>「导入」上传 Word 真题，校对后发布到题库（或直接用已有试卷）。</li>
          <li>「班级」建班拿到六位加入码，发给学生；学生首次进入输入加入码即可绑定。</li>
          <li>「任务」选试卷（或勾选小题）、班级、模式与时间发布；学生手机进入首页即可作答。</li>
          <li>「批改」处理待复核的主观题；「学情」看每题正确率与常见错答，一键导出 CSV。</li>
        </ol>
      </div>
    </main>
  )
}
