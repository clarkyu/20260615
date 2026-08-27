import { asc } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { papers } from '@/lib/db/schema'
import { getSession } from '@/lib/auth/session'
import { StartPracticeButton, DevLoginButton } from '@/components/home/StartPractice'

// 学生端首页(M2):试卷列表 + 「开始练习」入口。任务(assignment)列表在 M3/M6 接入。
// M2 先列全部试卷(发布流转在 M5 落地后改为学生仅见 published,见 docs/DECISIONS.md D7)。
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const session = await getSession()
  const user = session.user

  const rows = user
    ? await getDb()
        .select({
          id: papers.id,
          title: papers.title,
          year: papers.year,
          totalScore: papers.totalScore,
          durationMinutes: papers.durationMinutes,
        })
        .from(papers)
        .orderBy(asc(papers.year), asc(papers.title))
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
          <p className="mt-1 text-sm text-neutral-500">正式登录入口接入中;开发环境可用下面的快捷登录。</p>
          {process.env.AUTH_DEV_LOGIN === 'true' ? (
            <div className="mt-3 flex gap-2">
              <DevLoginButton role="student" label="以学生身份登录" />
              <DevLoginButton role="teacher" label="以教师身份登录" />
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <p className="text-sm text-neutral-500">
            {user.name},选一份试卷开始练习。做完一组点「对答案」,立刻看对错和解析。
          </p>
          {rows.length === 0 ? (
            <div className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
              <p className="font-medium">还没有试卷</p>
              <p className="mt-1 text-sm text-neutral-500">等老师导入试卷后,这里会出现练习入口。</p>
            </div>
          ) : (
            rows.map((p) => (
              <div key={p.id} className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.title}</p>
                    <p className="mt-1 text-sm text-neutral-500">
                      满分 {p.totalScore} 分 · 建议 {p.durationMinutes} 分钟
                    </p>
                  </div>
                  <StartPracticeButton paperId={p.id} />
                </div>
              </div>
            ))
          )}
        </>
      )}
    </main>
  )
}
