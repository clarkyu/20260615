import { asc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { papers } from '@/lib/db/schema'
import { ensureUser } from '@/lib/db/queries'
import { studentAssignments } from '@/lib/db/assignments'
import { dailyPlan } from '@/lib/db/training'
import Link from 'next/link'
import { getSession } from '@/lib/auth/session'
import { oidcConfigured } from '@/lib/auth/oidc'
import { LoginButton } from '@/components/auth/LoginButton'
import { StartAttemptButton, DevLoginButton } from '@/components/home/StartPractice'
import { AssignmentItem, JoinClassForm, type AssignmentCard } from '@/components/home/Assignments'

// 学生端首页(M5):加入班级 + 我的任务 + 自由练习。
// 任务由老师在教师端发布(SPEC §8);自由练习只列已发布(published)的试卷(D7 于 M7 收紧)。
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const session = await getSession()
  const user = session.user
  const oidc = oidcConfigured()
  const db = getDb()

  const rows = user
    ? await db
        .select({
          id: papers.id,
          title: papers.title,
          year: papers.year,
          totalScore: papers.totalScore,
          durationMinutes: papers.durationMinutes,
        })
        .from(papers)
        .where(eq(papers.status, 'published'))
        .orderBy(asc(papers.year), asc(papers.title))
    : []
  const userId = user ? await ensureUser(db, user) : null
  const plan = userId ? await dailyPlan(db, userId) : null
  const tasks: AssignmentCard[] = user && userId
    ? (await studentAssignments(db, userId)).map((a) => ({
        id: a.id,
        title: a.title,
        mode: a.mode,
        className: a.className,
        dueAt: a.dueAt?.toISOString() ?? null,
        opensAt: a.opensAt?.toISOString() ?? null,
        durationMinutes: a.durationMinutes,
        open: a.open,
        openReason: a.openReason,
        itemCount: a.itemCount,
        allowRetake: a.allowRetake,
        attempt: a.attempt,
      }))
    : []

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-xl font-bold">专升本英语题库</h1>
        <p className="mt-1 text-neutral-500">从微信群链接进来就能做题:作答、训练、模考。</p>
      </div>

      {!user ? (
        <div className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="font-medium">请先登录</p>
          {oidc ? (
            <>
              <p className="mt-1 text-sm text-neutral-500">用学校统一身份登录，登录后就能看到老师布置的任务。</p>
              <div className="mt-3">
                <LoginButton returnTo="/" label="登录" />
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-neutral-500">统一身份登录还没配置；开发环境可用下面的快捷登录。</p>
          )}
          {process.env.AUTH_DEV_LOGIN === 'true' ? (
            <div className="mt-3 flex gap-2">
              <DevLoginButton role="student" label="以学生身份登录" />
              <DevLoginButton role="teacher" label="以教师身份登录" />
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {plan ? (
            <Link href="/train" className="flex items-center justify-between rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/40">
              <div>
                <p className="font-medium">每日训练</p>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                  复习错题 {plan.dueDone} / {plan.due} · 新题 {plan.newDone} / {plan.newTarget}
                </p>
              </div>
              <span className="min-h-11 inline-flex items-center rounded-xl bg-blue-600 px-4 font-medium text-white">去训练</span>
            </Link>
          ) : null}
          <section className="flex flex-col gap-3">
            <h2 className="font-semibold">我的任务</h2>
            {tasks.length === 0 ? (
              <div className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
                <p className="font-medium">还没有任务</p>
                <p className="mt-1 text-sm text-neutral-500">输入老师发的加入码进班，老师布置的练习和考试会出现在这里。</p>
                <div className="mt-3">
                  <JoinClassForm />
                </div>
              </div>
            ) : (
              <>
                {tasks.map((a) => (
                  <AssignmentItem key={a.id} a={a} />
                ))}
                <details className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
                  <summary className="min-h-11 cursor-pointer leading-[2.75rem] text-sm text-neutral-500">加入另一个班级</summary>
                  <div className="mt-2">
                    <JoinClassForm />
                  </div>
                </details>
              </>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-semibold">自由练习</h2>
            <p className="text-sm text-neutral-500">{user.name},选一份试卷开始练习。做完一组点「对答案」,立刻看对错和解析。</p>
            {rows.length === 0 ? (
              <div className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
                <p className="font-medium">还没有试卷</p>
                <p className="mt-1 text-sm text-neutral-500">等老师导入试卷后,这里会出现练习入口。</p>
              </div>
            ) : (
              rows.map((p) => (
                <div key={p.id} className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
                  <p className="truncate font-medium">{p.title}</p>
                  <p className="mt-1 text-sm text-neutral-500">
                    满分 {p.totalScore} 分 · 考试限时 {p.durationMinutes} 分钟
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <StartAttemptButton paperId={p.id} mode="exam" label="模拟考试" variant="outline" />
                    <StartAttemptButton paperId={p.id} mode="practice" label="开始练习" />
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </main>
  )
}
