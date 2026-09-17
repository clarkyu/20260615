import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
import { requireTeacherPage } from '@/lib/auth/teacher'
import { getDb } from '@/lib/db/client'
import { classes } from '@/lib/db/schema'
import { classMemberCount } from '@/lib/db/assignments'
import { CreateClassForm } from '@/components/teacher/ClassForms'
import { fmtTime } from '@/lib/teacher/item-preview'

export const dynamic = 'force-dynamic'

// 班级(SPEC §8):建班拿六位加入码发给学生;列表显示人数与加入码。
export default async function TeacherClasses() {
  const { userId } = await requireTeacherPage()
  const db = getDb()
  const rows = await db.select().from(classes).where(eq(classes.teacherId, userId)).orderBy(desc(classes.createdAt))
  const members = await classMemberCount(db, rows.map((c) => c.id))
  return (
    <main>
      <h1 className="text-2xl font-bold">班级</h1>
      <p className="mt-1 text-sm text-neutral-500">建班后把六位加入码发到微信群，学生在首页输入即可入班；一个学生可以在多个班。</p>
      <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <CreateClassForm />
      </div>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-neutral-100 text-left dark:bg-neutral-800">
            <tr>
              <th className="p-3">班级</th>
              <th className="p-3">加入码</th>
              <th className="p-3">人数</th>
              <th className="p-3">创建时间</th>
              <th className="p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="p-3 font-medium">{c.name}</td>
                <td className="p-3 font-mono text-lg tracking-widest">{c.joinCode}</td>
                <td className="p-3">{members.get(c.id) ?? 0}</td>
                <td className="p-3 text-neutral-500">{fmtTime(c.createdAt)}</td>
                <td className="p-3">
                  <Link href={`/teacher/classes/${c.id}`} className="text-blue-600 hover:underline">
                    成员
                  </Link>
                  <span className="mx-2 text-neutral-300">|</span>
                  <Link href={`/teacher/assignments?classId=${c.id}`} className="text-blue-600 hover:underline">
                    发布任务
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="p-6 text-center text-neutral-400" colSpan={5}>
                  还没有班级，先在上面新建一个。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  )
}
