import Link from 'next/link'
import { requireTeacherPage } from '@/lib/auth/teacher'
import { getDb } from '@/lib/db/client'
import { bankFacets, listBankItems, type BankFilter } from '@/lib/db/item-bank'
import { ITEM_TYPE_LABEL, itemPreview } from '@/lib/teacher/item-preview'

export const dynamic = 'force-dynamic'

// 题库(SPEC §8):按试卷 / 年份 / 题型 / 知识点 / 状态 / 来源筛选。
// 筛选条件全走查询串 —— 老师能把一个筛选结果的链接直接发给同事,刷新也不丢。

const PAGE = 50

function parseFilter(sp: Record<string, string | string[] | undefined>): BankFilter {
  const one = (k: string) => {
    const v = sp[k]
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined
  }
  const num = (k: string) => {
    const v = one(k)
    const n = v === undefined ? Number.NaN : Number(v)
    return Number.isInteger(n) ? n : undefined
  }
  const status = one('status')
  const origin = one('origin')
  return {
    paperId: one('paperId'),
    year: num('year'),
    type: one('type'),
    tag: one('tag'),
    status: status === 'draft' || status === 'approved' ? status : undefined,
    origin: origin === 'official' || origin === 'teacher' || origin === 'ai' ? origin : undefined,
    number: num('number'),
    limit: PAGE,
    offset: Math.max(num('offset') ?? 0, 0),
  }
}

/** 把当前筛选拼回查询串;传 undefined 清掉某一项。 */
function href(base: BankFilter, patch: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams()
  const cur: Record<string, unknown> = { paperId: base.paperId, year: base.year, type: base.type, tag: base.tag, status: base.status, origin: base.origin, number: base.number, offset: base.offset }
  for (const [k, v] of Object.entries({ ...cur, ...patch })) {
    if (v === undefined || v === '' || (k === 'offset' && Number(v) === 0)) continue
    q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `/teacher/bank?${s}` : '/teacher/bank'
}

function Chip({ active, to, children }: { active: boolean; to: string; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      className={`rounded-full border px-3 py-1 text-sm ${active ? 'border-blue-600 bg-blue-600 text-white' : 'border-neutral-300 bg-white hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800'}`}
    >
      {children}
    </Link>
  )
}

export default async function BankPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireTeacherPage()
  const sp = await searchParams
  const filter = parseFilter(sp)
  const db = getDb()
  const [facets, result] = await Promise.all([bankFacets(db), listBankItems(db, filter)])
  const years = [...new Set(facets.papers.map((p) => p.year))].sort((a, b) => b - a)
  const offset = filter.offset ?? 0
  const filtered = Boolean(filter.paperId || filter.year || filter.type || filter.tag || filter.status || filter.origin || filter.number !== undefined)

  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">题库</h1>
          <p className="mt-1 text-sm text-neutral-500">
            共 {facets.papers.reduce((s, p) => s + p.itemCount, 0)} 道小题
            {facets.drafts > 0 ? (
              <>
                ，其中 <Link href={href({}, { status: 'draft' })} className="text-blue-600 underline">{facets.drafts} 道待审核草稿</Link>
              </>
            ) : null}
            。
          </p>
        </div>
        <Link href="/teacher/bank/candidates" className="rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
          答案候选
        </Link>
      </div>

      <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 shrink-0 text-neutral-500">试卷</span>
          <Chip active={!filter.paperId} to={href(filter, { paperId: undefined, offset: 0 })}>全部</Chip>
          {facets.papers.map((p) => (
            <Chip key={p.id} active={filter.paperId === p.id} to={href(filter, { paperId: p.id, offset: 0 })}>
              {p.title}（{p.itemCount}）
            </Chip>
          ))}
        </div>
        {years.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 shrink-0 text-neutral-500">年份</span>
            <Chip active={filter.year === undefined} to={href(filter, { year: undefined, offset: 0 })}>全部</Chip>
            {years.map((y) => (
              <Chip key={y} active={filter.year === y} to={href(filter, { year: y, offset: 0 })}>
                {y}
              </Chip>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 shrink-0 text-neutral-500">题型</span>
          <Chip active={!filter.type} to={href(filter, { type: undefined, offset: 0 })}>全部</Chip>
          {facets.types.map((t) => (
            <Chip key={t.type} active={filter.type === t.type} to={href(filter, { type: t.type, offset: 0 })}>
              {ITEM_TYPE_LABEL[t.type] ?? t.type}（{t.n}）
            </Chip>
          ))}
        </div>
        {facets.tags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 shrink-0 text-neutral-500">知识点</span>
            <Chip active={!filter.tag} to={href(filter, { tag: undefined, offset: 0 })}>全部</Chip>
            {facets.tags.map((t) => (
              <Chip key={t.tag} active={filter.tag === t.tag} to={href(filter, { tag: t.tag, offset: 0 })}>
                {t.tag}（{t.n}）
              </Chip>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 shrink-0 text-neutral-500">状态</span>
          <Chip active={!filter.status} to={href(filter, { status: undefined, offset: 0 })}>全部</Chip>
          <Chip active={filter.status === 'approved'} to={href(filter, { status: 'approved', offset: 0 })}>已通过</Chip>
          <Chip active={filter.status === 'draft'} to={href(filter, { status: 'draft', offset: 0 })}>待审核草稿</Chip>
          <span className="ml-4 w-16 shrink-0 text-neutral-500">来源</span>
          <Chip active={!filter.origin} to={href(filter, { origin: undefined, offset: 0 })}>全部</Chip>
          <Chip active={filter.origin === 'official'} to={href(filter, { origin: 'official', offset: 0 })}>真题</Chip>
          <Chip active={filter.origin === 'teacher'} to={href(filter, { origin: 'teacher', offset: 0 })}>老师录入</Chip>
          <Chip active={filter.origin === 'ai'} to={href(filter, { origin: 'ai', offset: 0 })}>AI 变式</Chip>
        </div>
        {filtered ? (
          <div>
            <Link href="/teacher/bank" className="text-sm text-blue-600 underline">
              清空筛选
            </Link>
          </div>
        ) : null}
      </div>

      <p className="mt-4 text-sm text-neutral-500">
        筛出 {result.total} 道
        {result.total > PAGE ? `，本页显示第 ${offset + 1}–${Math.min(offset + PAGE, result.total)} 道` : ''}。
      </p>

      {result.items.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
          没有符合条件的小题。换个筛选条件试试，或者<Link href="/teacher/import" className="text-blue-600 underline">导入一份新试卷</Link>。
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-neutral-100 text-left dark:bg-neutral-800">
              <tr>
                <th className="p-3 w-16">题号</th>
                <th className="p-3 w-28">题型</th>
                <th className="p-3">题面</th>
                <th className="p-3 w-48">试卷 / 大题</th>
                <th className="p-3 w-40">标签 / 状态</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((it) => (
                <tr key={it.id} className="border-t border-neutral-200 align-top dark:border-neutral-800">
                  <td className="p-3 font-mono">{it.number}</td>
                  <td className="p-3">{ITEM_TYPE_LABEL[it.type] ?? it.type}</td>
                  <td className="p-3">
                    <Link href={`/teacher/papers/${it.paperId}#item-${it.number}`} className="text-blue-600 hover:underline">
                      {itemPreview(it.type, it.content)}
                    </Link>
                  </td>
                  <td className="p-3 text-neutral-500">
                    {it.paperTitle}
                    {it.sectionTitle ? <span className="block text-xs">{it.sectionTitle}</span> : null}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {it.knowledgeTags.map((t) => (
                        <Link key={t} href={href(filter, { tag: t, offset: 0 })} className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300">
                          {t}
                        </Link>
                      ))}
                    </div>
                    {it.status === 'draft' ? <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">待审核</span> : null}
                    {it.origin === 'ai' ? <span className="mt-1 ml-1 inline-block rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800 dark:bg-violet-900 dark:text-violet-200">AI 变式</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.total > PAGE ? (
        <div className="mt-4 flex items-center gap-3 text-sm">
          {offset > 0 ? (
            <Link href={href(filter, { offset: Math.max(offset - PAGE, 0) })} className="rounded-xl border border-neutral-300 px-3 py-2 dark:border-neutral-700">
              上一页
            </Link>
          ) : null}
          {offset + PAGE < result.total ? (
            <Link href={href(filter, { offset: offset + PAGE })} className="rounded-xl border border-neutral-300 px-3 py-2 dark:border-neutral-700">
              下一页
            </Link>
          ) : null}
        </div>
      ) : null}
    </main>
  )
}
