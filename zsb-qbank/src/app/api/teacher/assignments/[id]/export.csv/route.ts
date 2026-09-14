import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db/client'
import { loadAssignmentStats } from '@/lib/db/stats'
import { statsToCsvRows } from '@/lib/stats/assignment-stats'
import { contentDisposition, toCsvWithBom } from '@/lib/stats/csv'
import { requireTeacherApi } from '@/lib/auth/teacher'
import { isUuid } from '@/lib/uuid'

// GET /api/teacher/assignments/:id/export.csv(SPEC §9.4):学情导出,UTF-8 BOM + CRLF,Excel 直接打开。
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTeacherApi()
  if (!auth.ok) return auth.res
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: { code: 'not_found', message: '任务不存在' } }, { status: 404 })
  const out = await loadAssignmentStats(getDb(), auth.ctx.userId, id)
  if (!out) return NextResponse.json({ error: { code: 'not_found', message: '任务不存在' } }, { status: 404 })
  const csv = toCsvWithBom(statsToCsvRows(out.stats, { title: out.assignment.title, className: out.className }))
  const name = `${out.assignment.title}-${out.className}-学情.csv`.replace(/[\\/:*?"<>|]/g, '_')
  return new NextResponse(csv, {
    status: 200,
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': contentDisposition(name), 'cache-control': 'no-store' },
  })
}
