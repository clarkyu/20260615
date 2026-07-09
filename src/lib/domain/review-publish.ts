// 学期总评「发布」编排:发布 = 以当下活数据现场重算全表 → 校验 → 组不可变快照 →
// 版本+1 单条落库(并发双击由唯一键兜住)。学生只见已发布快照;撤回=标记;修订=新版本。
// 预览 = 下一版快照 vs 当前在线版的逐生 diff + 及格翻转 + 「计0」名单——发布前强制过目。
import type { PrismaClient, Role } from '@prisma/client'
import * as reviewRepo from '@/lib/repo/review'
import {
  assembleSnapshot,
  categoryAuto,
  computeTotal,
  diffPublish,
  effectiveCategories,
  validateReviewConfig,
  type PublishDiff,
  type ReviewSnapshot,
  type SnapshotStudent,
} from './review'
import type { WorkbenchData } from './review-load'

interface Actor {
  schoolId: number | null | undefined
  userId: number
  role: Role
}

// 由工作台数据组快照(纯函数,单测):auto/override/exempt/生效/总评全部落进每生一行,
// 任何一版都可离线复算核验(minors 申诉安全)。
export function buildSnapshot(data: WorkbenchData): { snapshot: ReviewSnapshot; missingZeroStudents: number[] } {
  const missingZeroStudents: number[] = []
  const students: SnapshotStudent[] = data.students.map((s) => {
    const auto = categoryAuto(s.inputs, data.config)
    if (auto.missingCounted.length > 0) missingZeroStudents.push(s.id)
    const cats = effectiveCategories(auto, s.overrides)
    return {
      id: s.id,
      no: s.no,
      name: s.name,
      cat: {
        classroom: { auto: cats.classroom.auto, ovr: cats.classroom.override, exempt: cats.classroom.exempt, fin: cats.classroom.fin },
        training: { auto: cats.training.auto, ovr: cats.training.override, exempt: cats.training.exempt, fin: cats.training.fin },
        final: { auto: cats.final.auto, ovr: cats.final.override, exempt: cats.final.exempt, fin: cats.final.fin },
      },
      total: computeTotal(cats, data.config.weights),
    }
  })
  return { snapshot: assembleSnapshot(students), missingZeroStudents }
}

// 发布前置校验:比例合法;weight>0 的类别必须全班有数据来源(课堂未导入却占比>0 → 阻断,
// 老师要么导入、要么把课堂比例设 0)。返回 i18n key | null。
export function publishBlocker(data: WorkbenchData): string | null {
  const err = validateReviewConfig(data.config)
  if (err) return err
  if (data.students.length === 0) return 'review.errPublishEmpty'
  const classroomHasData = data.classPerf != null && data.students.some((s) => s.inputs.classroom != null)
  if (data.config.weights.classroom > 0 && !classroomHasData) return 'review.errPublishClassroom'
  if (data.config.weights.training > 0 && data.config.categories.training.assignmentIds.length === 0) return 'review.errPublishTraining'
  if (data.config.weights.final > 0 && data.config.categories.final.assignmentIds.length === 0) return 'review.errPublishFinal'
  return null
}

export interface PublishPreview {
  nextVersion: number
  diff: PublishDiff
  missingZeroStudents: number[]
  blocker: string | null
  classAggTotalMean: number | null
}

export async function previewPublish(
  prisma: PrismaClient,
  offeringId: number,
  data: WorkbenchData,
  actor: Actor,
): Promise<PublishPreview> {
  const { snapshot, missingZeroStudents } = buildSnapshot(data)
  const live = await reviewRepo.latestLivePublish(prisma, offeringId, actor.schoolId, actor.userId, actor.role)
  const prev = live ? (JSON.parse(live.snapshotJson) as ReviewSnapshot) : null
  const maxV = await reviewRepo.maxPublishVersion(prisma, offeringId, actor.schoolId, actor.userId, actor.role)
  return {
    nextVersion: maxV + 1,
    diff: diffPublish(prev, snapshot),
    missingZeroStudents,
    blocker: publishBlocker(data),
    classAggTotalMean: snapshot.classAgg.total.mean,
  }
}

export async function publishReview(
  prisma: PrismaClient,
  offeringId: number,
  data: WorkbenchData,
  actor: Actor,
  note: string,
): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const blocker = publishBlocker(data)
  if (blocker) return { ok: false, error: blocker }
  const { snapshot } = buildSnapshot(data)
  const version = (await reviewRepo.maxPublishVersion(prisma, offeringId, actor.schoolId, actor.userId, actor.role)) + 1
  const res = await reviewRepo.createPublish(prisma, {
    offeringId,
    version,
    configJson: JSON.stringify(data.config),
    snapshotJson: JSON.stringify(snapshot),
    note: note.trim().slice(0, 200) || null,
    publishedById: actor.userId,
  })
  if (res === 'conflict') return { ok: false, error: 'review.errPublishRace' }
  return { ok: true, version }
}
