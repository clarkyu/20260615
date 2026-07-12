// Student submission policy: which attempt is active (class targeted, window open,
// attempts left) and whether every required part is present. Pure-ish — data reads
// go through repos; no auth/i18n/Next plumbing. Errors are i18n keys.

import type { PrismaClient, SubmissionStatus } from '@prisma/client'
import * as assignments from '@/lib/repo/assignments'
import * as submissions from '@/lib/repo/submissions'
import { phaseItemType } from '@/lib/phase-item-type'
import { sniffMediaContainer } from '@/lib/media-sniff'
import { isPhaseActiveFor, branchTopicsOf } from '@/lib/domain/selection'

// The submission that represents a phase's state on the student's STATUS screens (home
// list + multi-phase checklist): the latest non-DRAFT attempt if one exists, otherwise
// the latest attempt (an in-progress draft). Starting a redo creates a higher-attempt
// DRAFT — it must NOT erase the student's already-submitted/graded attempt from view
// (that's why "提交成功的视频显示未提交"). Teacher-side queries already exclude DRAFT;
// this keeps the student view consistent. `subs` must be ordered by attempt DESC, as
// the repo queries return them.
export function representativeSubmission<T extends { status: SubmissionStatus }>(subs: T[]): T | null {
  return subs.find((s) => s.status !== 'DRAFT') ?? subs[0] ?? null
}

export interface Requirements {
  requireText: boolean
  requireVideo: boolean
  requireAudio: boolean
  requireHandwriting: boolean
  requireChoice: boolean
  requireFreeText: boolean
  fillBlank: boolean
}

export type AttemptResult =
  | { ok: false; error: string }
  | { ok: true; attempt: number; assignmentId: number; offeringId: number; phaseId: number; requirements: Requirements }

// Confirms the student may submit a PHASE (class targeted & its window open & its
// attempts left); returns the active attempt number, the owning assignment id, and
// the phase's submit requirements, or an i18n error key. A submission is per-phase,
// so the window and attempt cap come from the phase, not the assignment.
export async function resolveAttempt(
  prisma: PrismaClient,
  studentId: number,
  classIds: number[],
  phaseId: number,
): Promise<AttemptResult> {
  if (classIds.length === 0) return { ok: false, error: 'err.noClassAssigned' }
  const phase = await assignments.findPhaseForClasses(prisma, phaseId, classIds)
  if (!phase) return { ok: false, error: 'err.assignNotFound' }

  // 甲·分流硬门:本环节若挂了「归属题目」(带门),只有在「选题·分流」环节选中对应题目的学生能提交——
  // 防绕过前端直接 POST 到别人的分支。只有带门环节才多查一次(公共环节零开销,保持原路径不变)。
  if (branchTopicsOf(phase.branchTopicsJson).length > 0) {
    const chosenTopic = await submissions.findChosenTopic(prisma, phase.assignmentId, studentId)
    if (!isPhaseActiveFor(phase.branchTopicsJson, chosenTopic)) return { ok: false, error: 'err.phaseNotYours' }
  }

  const now = new Date()
  if (phase.openAt && now < phase.openAt) return { ok: false, error: 'err.notOpen' }
  if (phase.dueAt && now > phase.dueAt) return { ok: false, error: 'err.closed' }

  // 自由练习环节不限提交次数；其余按 maxAttempts 限制。
  const used = await submissions.countActiveAttempts(prisma, phaseId, studentId)
  if (!phase.freePractice && used >= phase.maxAttempts) return { ok: false, error: 'err.attemptsUsed' }
  return {
    ok: true,
    attempt: used + 1,
    assignmentId: phase.assignmentId,
    offeringId: phase.assignment.offeringId,
    phaseId,
    requirements: {
      requireText: phase.requireText,
      requireVideo: phase.requireVideo,
      requireAudio: phase.requireAudio,
      requireHandwriting: phase.requireHandwriting,
      requireChoice: phase.requireChoice,
      requireFreeText: phase.requireFreeText,
      fillBlank: phase.fillBlank,
    },
  }
}

interface Parts {
  recitedText: string | null
  videoKey: string | null
  audioKey: string | null
  imageKey: string | null
}

// The first required part the student hasn't provided yet, as an i18n key — or null
// when the submission is complete. 单选投票 / 自由文本 都把答案存在 recitedText 里。
export function missingRequiredPart(assignment: Requirements, submission: Parts): string | null {
  if (assignment.requireText && !submission.recitedText) return 'err.needRecite'
  if (assignment.requireVideo && !submission.videoKey) return 'err.noVideoYet'
  if (assignment.requireAudio && !submission.audioKey) return 'err.noAudioYet'
  if (assignment.requireHandwriting && !submission.imageKey) return 'err.noImageYet'
  if (assignment.requireChoice && !submission.recitedText) return 'err.needChoice'
  if (assignment.requireFreeText && !submission.recitedText) return 'err.needFreeText'
  if (assignment.fillBlank && !submission.recitedText) return 'err.needFillBlank'
  return null
}

// A pure 单选投票 环节（只有 requireChoice、没有任何需要评分/复核的部分）。投票没有对错、
// 无需老师批阅，所以完成时直接定稿、不进待批队列。其余（含自由文本）仍按需复核。
// 判别集中到 phaseItemType（单一事实来源）：objective 即 poll-only —— itemType==='objective'
// ⟺ 旧的「requireChoice 且无其它提交部分」定义，行为完全一致。
export function isPollOnly(r: Requirements): boolean {
  return phaseItemType(r) === 'objective'
}

// 提交完整性门(期末考核复盘):键在库里 ≠ 对象在存储里——上传中断/空录像同样会留下键,
// 这样的行进了评阅队列只会反复 404/空内容直到死信。环节要求的媒体逐个探测:缺失或空
// → 拦下提交,让学生当场重录/重传。'unknown'(网络抖动/5xx)放行——偶发故障不该
// 卡住全班提交,真有问题还有评前预检兜底。probe 注入便于测试(生产用 storage.probeObject)。
// 探针复测:R2 偶发瞬时 404/416(实证见评阅总账「404 是暂时性取件失败」)。首判 missing/empty
// 不立即定罪——短暂等待后复测一次,两次一致才算坏。'ok'/'unknown' 直接透传(unknown 本就放行)。
export async function resilientProbe(
  probe: (key: string) => Promise<'ok' | 'empty' | 'missing' | 'unknown'>,
  key: string,
  delayMs = 300,
): Promise<'ok' | 'empty' | 'missing' | 'unknown'> {
  const first = await probe(key)
  if (first === 'ok' || first === 'unknown') return first
  await new Promise((r) => setTimeout(r, delayMs))
  return probe(key)
}

export async function requiredMediaUnhealthy(
  requirements: Pick<Requirements, 'requireVideo' | 'requireAudio'>,
  submission: Pick<Parts, 'videoKey' | 'audioKey'>,
  probe: (key: string) => Promise<'ok' | 'empty' | 'missing' | 'unknown'>,
): Promise<boolean> {
  const checks: [boolean | null | undefined, string | null][] = [
    [requirements.requireVideo, submission.videoKey],
    [requirements.requireAudio, submission.audioKey],
  ]
  for (const [required, key] of checks) {
    if (!required || !key) continue // 键都没有的走 missingRequiredPart 的既有提示
    const health = await probe(key)
    if (health === 'missing' || health === 'empty') return true
  }
  return false
}

// 坏媒体即时拒收:对象在、有字节,但首字节不是任何已知媒体容器的魔数(全零/截断/垃圾
// 字节)——这样的文件到评阅时才被 Gemini 报 corrupt、死信、归档缺交,学生几天后才知道。
// 提交定稿时读头部嗅探,当场拒收让学生重录。保守一票否决:读不到头(readHead 返回 null,
// 网络抖/404)不拦——在/空的判定归健康探针,偶发故障绝不该卡提交;命中任一已知容器放行。
export async function corruptRequiredMedia(
  requirements: Pick<Requirements, 'requireVideo' | 'requireAudio'>,
  submission: Pick<Parts, 'videoKey' | 'audioKey'>,
  readHead: (key: string) => Promise<Uint8Array | null>,
): Promise<boolean> {
  const checks: [boolean | null | undefined, string | null][] = [
    [requirements.requireVideo, submission.videoKey],
    [requirements.requireAudio, submission.audioKey],
  ]
  for (const [required, key] of checks) {
    if (!required || !key) continue
    const head = await readHead(key)
    if (!head || head.length === 0) continue // 取不到/空:无法判断,放行(健康探针与评前预检兜底)
    if (sniffMediaContainer(head) === 'unknown') return true
  }
  return false
}

// 逐句跟读(shadow)提交完整性门:逐句音频存在 ShadowTake 行里,不在 videoKey/audioKey,
// 所以 requiredMediaUnhealthy 探不到——一条 0 字节/缺失的 take 照样能定稿,评阅时反复空/404
// 到死信,且 shadow 从不标 FAILED,坏账在看板里隐形。提交前逐条探测:空(416)或缺(404)→
// 收集该句 order,让学生指名重录那一句。与 requiredMediaUnhealthy 同策:'unknown'(网络抖/5xx)
// 放行,偶发故障不卡提交(评前预检兜底)。分批并发探测(bounded)——一次逐句提交可能几十句,
// 串行太慢、全并发又怕打爆 Workers 子请求上限。返回坏掉的句子 order(升序,空数组=全健康)。
export async function unhealthyShadowTakes(
  takes: { order: number; audioKey: string }[],
  probe: (key: string) => Promise<'ok' | 'empty' | 'missing' | 'unknown'>,
  concurrency = 8,
): Promise<number[]> {
  const bad: number[] = []
  for (let i = 0; i < takes.length; i += concurrency) {
    const batch = takes.slice(i, i + concurrency)
    const healths = await Promise.all(batch.map((tk) => probe(tk.audioKey)))
    batch.forEach((tk, j) => {
      if (healths[j] === 'missing' || healths[j] === 'empty') bad.push(tk.order)
    })
  }
  return bad.sort((a, b) => a - b)
}
