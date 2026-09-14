import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db/client'
import { loadStudentOverview } from '@/lib/db/stats'
import { contentDisposition, toCsvWithBom } from '@/lib/stats/csv'
import { ITEM_TYPE_LABEL, MODE_LABEL, ATTEMPT_STATUS_LABEL, fmtTime } from '@/lib/teacher/item-preview'
import { requireTeacherApi } from '@/lib/auth/teacher'
import { isUuid } from '@/lib/uuid'

// GET /api/teacher/students/:id/export.csv(SPEC §8「全部可导出 CSV」的学生维度):各次任务成绩、题型得分率、
// 错题数、复习到期数。仅本教师班级里的学生。
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTeacherApi()
  if (!auth.ok) return auth.res
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: { code: 'not_found', message: '学生不存在' } }, { status: 404 })
  const ov = await loadStudentOverview(getDb(), auth.ctx.userId, id)
  if (!ov) return NextResponse.json({ error: { code: 'not_found', message: '学生不在你的班级里' } }, { status: 404 })
  const rows: unknown[][] = [[`${ov.name} · 学情`, `错题数 ${ov.wrongCount}`, `复习到期 ${ov.reviewDue}`], []]
  rows.push(['任务', '班级', '模式', '状态', '得分', '满分', '交卷时间'])
  for (const a of ov.assignments) rows.push([a.title, a.className, MODE_LABEL[a.mode] ?? a.mode, ATTEMPT_STATUS_LABEL[a.status] ?? a.status, a.totalScore ?? '', a.fullScore ?? '', fmtTime(a.submittedAt)])
  rows.push([])
  rows.push(['题型', '题数', '得分', '满分', '得分率'])
  for (const t of ov.byType) rows.push([ITEM_TYPE_LABEL[t.type] ?? t.type, t.items, t.score, t.fullScore, `${Math.round(t.rate * 100)}%`])
  const name = `${ov.name}-学情.csv`.replace(/[\\/:*?"<>|]/g, '_')
  return new NextResponse(toCsvWithBom(rows), {
    status: 200,
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': contentDisposition(name), 'cache-control': 'no-store' },
  })
}
