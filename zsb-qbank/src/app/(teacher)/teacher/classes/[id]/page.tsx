import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, desc, eq } from 'drizzle-orm'
import { requireTeacherPage } from '@/lib/auth/teacher'
import { getDb } from '@/lib/db/client'
import { assignments, classMembers, classes, users } from '@/lib/db/schema'
import { fmtTime, MODE_LABEL } from '@/lib/teacher/item-preview'

export const dynamic = 'force-dynamic'

// 班级详情:成员名单 + 该班任务。
export default async function TeacherClassDetail({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireTeacherPage()
  const { id } = await params
  const db = getDb()
  const cls = await db.query.classes.findFirst({ where: and(eq(classes.id, id), eq(classes.teacherId, userId)) })
  if (!cls) notFound()
  const members = await db
    .select({ userId: classMembers.userId, name: users.name, joinedAt: classMembers.joinedAt })
    .from(classMembers)
    .innerJoin(users, eq(users.id, classMembers.userId))
    .where(eq(classMembers.classId, cls.id))
    .orderBy(asc(classMembers.joinedAt))
  const tasks = await db.select().from(assignments).where(eq(assignments.classId, cls.id)).orderBy(desc(assignments.createdAt))
  return (
    <main>
      <p className="text-sm">
        <Link href="/teacher/classes" className="text-blue-600 hover:underline">
          ← 班级
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold">{cls.name}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        加入码 <span className="font-mono text-lg tracking-widest">{cls.joinCode}</span> · {members.length} 人
      </p>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="font-semibold">成员</h2>
          <ul className="mt-2 divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
            {members.map((m) => (
              <li key={m.userId} className="flex justify-between py-2">
                <span>{m.name ?? '(未命名)'}</span>
                <span className="text-neutral-400">{fmtTime(m.joinedAt)}</span>
              </li>
            ))}
            {members.length === 0 ? <li className="py-2 text-neutral-400">还没有学生加入。</li> : null}
          </ul>
        </section>
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">任务</h2>
            <Link href={`/teacher/assignments?classId=${cls.id}`} className="text-sm text-blue-600 hover:underline">
              发布任务
            </Link>
          </div>
          <ul className="mt-2 divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
            {tasks.map((t) => (
              <li key={t.id} className="flex justify-between py-2">
                <Link href={`/teacher/assignments/${t.id}`} className="text-blue-600 hover:underline">
                  {t.title}
                </Link>
                <span className="text-neutral-400">
                  {MODE_LABEL[t.mode] ?? t.mode} · 截止 {fmtTime(t.dueAt)}
                </span>
              </li>
            ))}
            {tasks.length === 0 ? <li className="py-2 text-neutral-400">还没有任务。</li> : null}
          </ul>
        </section>
      </div>
    </main>
  )
}
