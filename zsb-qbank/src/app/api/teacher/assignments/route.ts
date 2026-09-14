import { NextResponse, type NextRequest } from 'next/server'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { assignments, classes, items, papers } from '@/lib/db/schema'
import { assignmentProgress, classMemberCount, createAssignmentSchema } from '@/lib/db/assignments'
import { requireTeacherApi } from '@/lib/auth/teacher'

// GET  /api/teacher/assignments:我发布的任务(班级名、试卷、模式、时间、作答/交卷人数)
// POST /api/teacher/assignments:发布任务(SPEC §8「组卷与发布」):整卷或勾选小题、班级、模式、
//      开放与截止、考试时长、解析可见、成绩发布方式;班级必须是本教师的;itemIds 必须属于该试卷。
export async function GET() {
  const auth = await requireTeacherApi()
  if (!auth.ok) return auth.res
  const db = getDb()
  const rows = await db
    .select({ a: assignments, className: classes.name, paperTitle: papers.title })
    .from(assignments)
    .innerJoin(classes, eq(assignments.classId, classes.id))
    .leftJoin(papers, eq(assignments.paperId, papers.id))
    .where(eq(classes.teacherId, auth.ctx.userId))
    .orderBy(desc(assignments.createdAt))
  const progress = await assignmentProgress(db, rows.map((r) => r.a.id))
  const members = await classMemberCount(db, [...new Set(rows.map((r) => r.a.classId))])
  return NextResponse.json({
    assignments: rows.map(({ a, className, paperTitle }) => ({
      id: a.id,
      title: a.title,
      mode: a.mode,
      classId: a.classId,
      className,
      paperId: a.paperId,
      paperTitle,
      itemCount: a.itemIds?.length ?? null,
      opensAt: a.opensAt,
      dueAt: a.dueAt,
      durationMinutes: a.durationMinutes,
      settings: a.settings,
      createdAt: a.createdAt,
      members: members.get(a.classId) ?? 0,
      started: progress.get(a.id)?.started ?? 0,
      submitted: progress.get(a.id)?.submitted ?? 0,
    })),
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireTeacherApi()
  if (!auth.ok) return auth.res
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: '请求体不是 JSON' } }, { status: 400 })
  }
  const parsed = createAssignmentSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request', message: '参数不正确：' + parsed.error.issues.map((i) => i.path.join('.')).join('、') } }, { status: 400 })
  }
  const input = parsed.data
  const db = getDb()
  const cls = await db.query.classes.findFirst({ where: and(eq(classes.id, input.classId), eq(classes.teacherId, auth.ctx.userId)) })
  if (!cls) return NextResponse.json({ error: { code: 'forbidden', message: '只能给自己的班级发布任务' } }, { status: 403 })
  const paper = await db.query.papers.findFirst({ where: eq(papers.id, input.paperId) })
  if (!paper) return NextResponse.json({ error: { code: 'not_found', message: '试卷不存在' } }, { status: 404 })
  if (input.itemIds) {
    const owned = await db.select({ id: items.id }).from(items).where(and(inArray(items.id, input.itemIds), eq(items.paperId, paper.id)))
    if (owned.length !== new Set(input.itemIds).size) {
      return NextResponse.json({ error: { code: 'bad_request', message: '勾选的小题必须都属于所选试卷' } }, { status: 400 })
    }
  }
  const opensAt = input.opensAt ? new Date(input.opensAt) : null
  const dueAt = input.dueAt ? new Date(input.dueAt) : null
  if (opensAt && dueAt && dueAt <= opensAt) return NextResponse.json({ error: { code: 'bad_request', message: '截止时间必须晚于开放时间' } }, { status: 400 })
  const durationMinutes = input.mode === 'exam' ? (input.durationMinutes ?? paper.durationMinutes) : null
  const [row] = await db
    .insert(assignments)
    .values({
      classId: cls.id,
      paperId: paper.id,
      itemIds: input.itemIds && input.itemIds.length > 0 ? [...new Set(input.itemIds)] : null,
      mode: input.mode,
      title: input.title,
      opensAt,
      dueAt,
      durationMinutes,
      settings: input.settings ?? { showExplanation: true, release: 'manual', allowRetake: false },
      createdBy: auth.ctx.userId,
    })
    .returning()
  if (!row) return NextResponse.json({ error: { code: 'internal', message: '创建失败' } }, { status: 500 })
  return NextResponse.json({ assignment: row }, { status: 201 })
}
