import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
import { requireTeacherPage } from '@/lib/auth/teacher'
import { getDb } from '@/lib/db/client'
import { assignments, classes } from '@/lib/db/schema'
import { loadAssignmentStats, loadStudentOverview } from '@/lib/db/stats'
import { ATTEMPT_STATUS_LABEL, ITEM_TYPE_LABEL, MODE_LABEL, fmtTime } from '@/lib/teacher/item-preview'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`)
function heat(r: number | null): string {
  if (r === null) return 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800'
  if (r >= 0.8) return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100'
  if (r >= 0.6) return 'bg-lime-100 text-lime-900 dark:bg-lime-900 dark:text-lime-100'
  if (r >= 0.4) return 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100'
  return 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100'
}

// 学情(SPEC §8):任务维度(正确率热力表、常见错答、分大题得分率、分布、学生矩阵、导出 CSV)
// 与学生维度(各次任务成绩、题型得分率、错题数、复习到期数)。
export default async function TeacherStats({ searchParams }: { searchParams: Promise<{ assignmentId?: string; studentId?: string }> }) {
  const { userId } = await requireTeacherPage()
  const sp = await searchParams
  const db = getDb()
  const list = await db
    .select({ id: assignments.id, title: assignments.title, className: classes.name, mode: assignments.mode })
    .from(assignments)
    .innerJoin(classes, eq(assignments.classId, classes.id))
    .where(eq(classes.teacherId, userId))
    .orderBy(desc(assignments.createdAt))
  const studentId = sp.studentId && UUID.test(sp.studentId) ? sp.studentId : undefined
  const assignmentId = sp.assignmentId && UUID.test(sp.assignmentId) ? sp.assignmentId : (studentId ? undefined : list[0]?.id)

  if (studentId) {
    const ov = await loadStudentOverview(db, userId, studentId)
    return (
      <main>
        <p className="text-sm">
          <Link href="/teacher/stats" className="text-blue-600 hover:underline">
            ← 学情
          </Link>
        </p>
        {!ov ? (
          <p className="mt-4 text-neutral-400">这个学生不在你的班级里。</p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-2xl font-bold">{ov.name}</h1>
              <a href={`/api/teacher/students/${ov.userId}/export.csv`} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white">
                导出 CSV
              </a>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ['任务数', ov.assignments.length],
                ['已交', ov.assignments.filter((a) => a.status !== 'not_started' && a.status !== 'in_progress').length],
                ['错题数', ov.wrongCount],
                ['复习到期', ov.reviewDue],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
                  <p className="text-xs text-neutral-500">{k}</p>
                  <p className="text-2xl font-bold">{v}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="font-semibold">各次任务</h2>
                <table className="mt-2 w-full text-sm">
                  <tbody>
                    {ov.assignments.map((a) => (
                      <tr key={a.id} className="border-t border-neutral-100 dark:border-neutral-800">
                        <td className="py-2">
                          <Link href={`/teacher/stats?assignmentId=${a.id}`} className="text-blue-600 hover:underline">
                            {a.title}
                          </Link>
                          <span className="ml-1 text-neutral-400">{a.className} · {MODE_LABEL[a.mode] ?? a.mode}</span>
                        </td>
                        <td className="py-2 text-neutral-500">{ATTEMPT_STATUS_LABEL[a.status] ?? a.status}</td>
                        <td className="py-2 text-right">{a.totalScore === null ? '—' : `${a.totalScore} / ${a.fullScore ?? '?'}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="font-semibold">题型得分率</h2>
                <table className="mt-2 w-full text-sm">
                  <tbody>
                    {ov.byType.map((t) => (
                      <tr key={t.type} className="border-t border-neutral-100 dark:border-neutral-800">
                        <td className="py-2">{ITEM_TYPE_LABEL[t.type] ?? t.type}</td>
                        <td className="py-2 text-neutral-500">{t.items} 题</td>
                        <td className="py-2 text-right">
                          {t.score} / {t.fullScore}
                        </td>
                        <td className={`py-2 text-right ${heat(t.rate)}`}>{pct(t.rate)}</td>
                      </tr>
                    ))}
                    {ov.byType.length === 0 ? (
                      <tr>
                        <td className="py-2 text-neutral-400">还没有已判的作答。</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </section>
            </div>
          </>
        )}
      </main>
    )
  }

  const data = assignmentId ? await loadAssignmentStats(db, userId, assignmentId) : null
  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">学情</h1>
        {data ? (
          <a href={`/api/teacher/assignments/${data.assignment.id}/export.csv`} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white">
            导出 CSV
          </a>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {list.map((a) => (
          <Link key={a.id} href={`/teacher/stats?assignmentId=${a.id}`} className={`rounded-full px-3 py-1 ${a.id === assignmentId ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900' : 'border border-neutral-300 dark:border-neutral-700'}`}>
            {a.title} · {a.className}
          </Link>
        ))}
        {list.length === 0 ? <span className="text-neutral-400">还没有任务，先去「任务」发布。</span> : null}
      </div>

      {data ? (
        <>
          <p className="mt-4 text-sm text-neutral-500">
            {data.paperTitle} · {data.className} · 满分 {data.stats.fullScore} · 已交 {data.stats.distribution.submitted} / {data.stats.students.length}
            {data.stats.distribution.pendingStudents ? `（${data.stats.distribution.pendingStudents} 人有待评小题，未计入平均与分布）` : ''}
            {data.stats.distribution.mean !== null ? ` · 平均 ${data.stats.distribution.mean} · 中位 ${data.stats.distribution.median} · 最高 ${data.stats.distribution.max} · 最低 ${data.stats.distribution.min}` : ''}
          </p>

          <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="font-semibold">每题正确率 / 得分率</h2>
            <p className="mt-1 text-xs text-neutral-400">客观题 = 答对人数 ÷ 已交人数；主观题 = 平均分 ÷ 满分；点题号看常见错答。</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {data.stats.items.map((it) => (
                <a key={it.itemId} href={`#item-${it.number}`} title={`${it.number} ${ITEM_TYPE_LABEL[it.type] ?? it.type}`} className={`flex h-12 w-12 flex-col items-center justify-center rounded-lg text-xs ${heat(it.rate)}`}>
                  <span className="font-mono font-medium">{it.number}</span>
                  <span>{pct(it.rate)}</span>
                </a>
              ))}
            </div>
          </section>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="font-semibold">分大题得分率</h2>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {data.stats.sections.map((s) => (
                    <tr key={s.sectionId} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="py-2">{s.title}</td>
                      <td className="py-2 text-right text-neutral-500">
                        {s.avgScore} / {s.fullScore}
                      </td>
                      <td className={`w-16 py-2 text-right ${heat(s.rate)}`}>{pct(s.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="font-semibold">班级分布（按满分百分比）</h2>
              <div className="mt-2 flex flex-col gap-1 text-sm">
                {data.stats.distribution.bins.map((b) => {
                  const w = data.stats.distribution.submitted ? Math.round((b.count / data.stats.distribution.submitted) * 100) : 0
                  return (
                    <div key={b.label} className="flex items-center gap-2">
                      <span className="w-14 text-neutral-500">{b.label}</span>
                      <div className="h-4 flex-1 rounded bg-neutral-100 dark:bg-neutral-800">
                        <div className="h-4 rounded bg-blue-500" style={{ width: `${w}%` }} />
                      </div>
                      <span className="w-8 text-right">{b.count}</span>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>

          <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="font-semibold">逐题明细与常见错答</h2>
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th className="py-1">题号</th>
                  <th className="py-1">题型</th>
                  <th className="py-1">满分</th>
                  <th className="py-1">作答 / 已交</th>
                  <th className="py-1">正确 / 平均</th>
                  <th className="py-1">率</th>
                  <th className="py-1">待评</th>
                  <th className="py-1">常见错答（前五）</th>
                </tr>
              </thead>
              <tbody>
                {data.stats.items.map((it) => (
                  <tr key={it.itemId} id={`item-${it.number}`} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="py-1 font-mono">{it.number}</td>
                    <td className="py-1">{ITEM_TYPE_LABEL[it.type] ?? it.type}</td>
                    <td className="py-1">{it.fullScore}</td>
                    <td className="py-1">
                      {it.answered} / {it.submitted}
                    </td>
                    <td className="py-1">{it.objective ? `${it.correct} 人` : `${it.avgScore ?? '—'} 分`}</td>
                    <td className={`py-1 ${heat(it.rate)}`}>{pct(it.rate)}</td>
                    <td className="py-1">{it.pending || ''}</td>
                    <td className="py-1 text-neutral-600 dark:text-neutral-300">{it.topWrong.map((w) => `${w.answer}（${w.count}）`).join('　')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="mt-4 overflow-x-auto rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="font-semibold">学生 × 小题</h2>
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th className="py-1 pr-2">学生</th>
                  <th className="py-1 pr-2">状态</th>
                  <th className="py-1 pr-2">总分</th>
                  {data.stats.items.map((it) => (
                    <th key={it.itemId} className="py-1 pr-1 font-mono font-normal">
                      {it.number}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.stats.students.map((s) => (
                  <tr key={s.userId} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="py-1 pr-2 whitespace-nowrap">
                      <Link href={`/teacher/stats?studentId=${s.userId}`} className="text-blue-600 hover:underline">
                        {s.name}
                      </Link>
                    </td>
                    <td className="py-1 pr-2 whitespace-nowrap text-neutral-500">
                      {ATTEMPT_STATUS_LABEL[s.status] ?? s.status}
                      {s.pending ? <span className="ml-1 text-amber-600">待评</span> : null}
                    </td>
                    <td className="py-1 pr-2">{s.totalScore ?? '—'}</td>
                    {s.scores.map((x, i) => {
                      const it = data.stats.items[i]!
                      return (
                        <td key={it.itemId} className={`py-1 pr-1 text-center ${x === null ? '' : heat(it.fullScore > 0 ? x / it.fullScore : null)}`}>
                          {x === null ? '' : x}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <p className="mt-2 text-xs text-neutral-400">发布时间 {fmtTime(data.assignment.createdAt)}；「每题中位用时」需要逐题计时埋点，首期未采集。</p>
        </>
      ) : null}
    </main>
  )
}
