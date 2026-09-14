import Link from 'next/link'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { items } from '@/lib/db/schema'
import { ensureUser } from '@/lib/db/queries'
import { myStats, TRAINABLE_TYPES } from '@/lib/db/training'
import { getSession } from '@/lib/auth/session'
import { TrainSession } from '@/components/train/TrainSession'
import { ITEM_TYPE_LABEL } from '@/lib/teacher/item-preview'

export const dynamic = 'force-dynamic'

// 训练页(SPEC §6 / M6):无参数 = 训练首页(今日任务进度、复习错题、专项训练入口、我的题型得分率);
// ?mode=daily|review|targeted(&type=&tags=)= 进入训练会话。
export default async function TrainPage({ searchParams }: { searchParams: Promise<{ mode?: string; type?: string; tags?: string }> }) {
  const session = await getSession()
  const sp = await searchParams
  if (!session.user) {
    return (
      <main className="flex flex-1 flex-col gap-4 px-4 py-6">
        <p className="font-medium">请先登录</p>
        <Link href="/" className="text-blue-600">回首页</Link>
      </main>
    )
  }
  const mode = sp.mode === 'daily' || sp.mode === 'review' || sp.mode === 'targeted' ? sp.mode : null
  if (mode) {
    const type = sp.type && (TRAINABLE_TYPES as readonly string[]).includes(sp.type) ? sp.type : undefined
    const tags = (sp.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10)
    return (
      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        <TrainSession mode={mode} type={type} tags={tags} />
      </main>
    )
  }

  const db = getDb()
  const userId = await ensureUser(db, session.user)
  const stats = await myStats(db, userId)
  // 可选知识点:已审核可训练小题里出现最多的前 24 个标签
  const tagRows = await db
    .select({ tag: sql<string>`t.tag`, n: sql<number>`count(*)::int` })
    .from(sql`${items}, unnest(${items.knowledgeTags}) as t(tag)`)
    .where(and(eq(items.status, 'approved'), inArray(items.type, [...TRAINABLE_TYPES])))
    .groupBy(sql`t.tag`)
    .orderBy(sql`count(*) desc`)
    .limit(24)
  const t = stats.today
  const dailyLeft = Math.max(0, t.due - t.dueDone) + Math.max(0, t.newTarget - t.newDone)
  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">训练</h1>
        <Link href="/" className="min-h-11 inline-flex items-center text-sm text-blue-600">
          回首页
        </Link>
      </div>

      <section className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
        <p className="font-medium">今日任务</p>
        <p className="mt-1 text-sm text-neutral-500">
          复习错题 {t.dueDone} / {t.due} · 新题 {t.newDone} / {t.newTarget}
          {t.weakestType ? ` · 先练最薄弱的「${ITEM_TYPE_LABEL[t.weakestType] ?? t.weakestType}」` : ''}
        </p>
        <div className="mt-3 h-2 rounded bg-neutral-100 dark:bg-neutral-800">
          <div className="h-2 rounded bg-blue-500" style={{ width: `${t.due + t.newTarget > 0 ? Math.min(100, Math.round(((t.dueDone + t.newDone) / (t.due + t.newTarget)) * 100)) : 0}%` }} />
        </div>
        <Link href="/train?mode=daily" className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-600 font-medium text-white">
          {dailyLeft === 0 ? '今天做完了，再来一组' : '开始今日任务'}
        </Link>
      </section>

      <section className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">复习错题</p>
            <p className="mt-1 text-sm text-neutral-500">
              错题本 {stats.wrongCount} 题，今天到期 {stats.reviewDue} 题
            </p>
          </div>
          <Link href="/train?mode=review" className={`inline-flex min-h-11 items-center rounded-xl px-4 font-medium ${stats.reviewDue > 0 ? 'bg-blue-600 text-white' : 'border border-neutral-300 text-neutral-500 dark:border-neutral-700'}`}>
            {stats.reviewDue > 0 ? '开始复习' : '没有到期'}
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
        <p className="font-medium">专项训练</p>
        <p className="mt-1 text-sm text-neutral-500">按题型或知识点抽题，只给所在句，不用看整篇。</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {TRAINABLE_TYPES.map((ty) => (
            <Link key={ty} href={`/train?mode=targeted&type=${ty}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-blue-600 text-blue-700 dark:text-blue-300">
              {ITEM_TYPE_LABEL[ty] ?? ty}
            </Link>
          ))}
        </div>
        {tagRows.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {tagRows.map((r) => (
              <Link key={r.tag} href={`/train?mode=targeted&tags=${encodeURIComponent(r.tag)}`} className="inline-flex min-h-11 items-center rounded-full border border-neutral-300 px-3 text-sm dark:border-neutral-700">
                {r.tag} <span className="ml-1 text-neutral-400">{r.n}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
        <p className="font-medium">我的题型得分率</p>
        {stats.byType.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-500">还没练过，做几题就有了。</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <tbody>
              {stats.byType.map((r) => (
                <tr key={r.type} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-2">{ITEM_TYPE_LABEL[r.type] ?? r.type}</td>
                  <td className="py-2 text-neutral-500">{r.items} 题 · {r.attempts} 次</td>
                  <td className="py-2 text-right font-medium">{Math.round(r.rate * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
