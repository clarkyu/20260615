import type { PrismaClient, Role, SubmissionStatus } from '@prisma/client'
import { localDayWindowUtc } from '@/lib/time'

// Read-model for the teacher dashboard: the headline counts + the "needs grading"
// board, in one place. Spans several aggregates (users/classes/assignments/
// offerings/submissions) so it lives in its own read repo rather than a single one.

// Submitted work the teacher still needs to look at — AI either hasn't handled it
// or wasn't confident enough to auto-approve (needsReview).
const NEEDS_TEACHER_STATUS: SubmissionStatus[] = ['UPLOADED', 'FLAGGED', 'GRADED', 'FAILED']

export async function loadStaffDashboard(prisma: PrismaClient, schoolId: number, userId: number, role: Role, tzo = 0) {
  // A teacher only sees their own offerings; admins see the whole school.
  const offeringWhere = { schoolId, ...(role === 'TEACHER' ? { teacherId: userId } : {}) }
  // "Due today" is the user's LOCAL calendar day (tzo from their browser).
  const { start: todayStart, end: todayEnd } = localDayWindowUtc(new Date(), tzo)

  const [students, classes, assignments, offeringsCount, pendingCount, dueToday, pendingGroups] = await Promise.all([
    prisma.user.count({ where: { schoolId, role: 'STUDENT' } }),
    prisma.classGroup.count({ where: { schoolId } }),
    prisma.assignment.count({ where: { offering: offeringWhere } }),
    prisma.courseOffering.count({ where: offeringWhere }),
    prisma.submission.count({ where: { needsReview: true, status: { in: NEEDS_TEACHER_STATUS }, assignment: { offering: offeringWhere } } }),
    prisma.assignment.count({ where: { offering: offeringWhere, dueAt: { gte: todayStart, lt: todayEnd } } }),
    prisma.submission.groupBy({
      by: ['assignmentId'],
      where: { needsReview: true, status: { in: NEEDS_TEACHER_STATUS }, assignment: { offering: offeringWhere } },
      _count: { _all: true },
    }),
  ])

  // 待批作业的展示行:带批次分组所需字段(batchId/mode/courseId),按新→旧排序——
  // groupAssignmentBatches 取每组首见(=最新)的展示字段,与作业列表页同契约。
  const ids = pendingGroups.map((g) => g.assignmentId)
  const needRows = ids.length
    ? await prisma.assignment.findMany({
        where: { id: { in: ids } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, title: true, category: true, mode: true, dueAt: true, batchId: true,
          offering: { select: { courseId: true, course: { select: { name: true } }, class: { select: { name: true } }, teacher: { select: { name: true } } } },
        },
      })
    : []

  return { students, classes, assignments, offeringsCount, pendingCount, dueToday, pendingGroups, needRows }
}
