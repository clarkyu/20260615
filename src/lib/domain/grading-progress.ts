// 学生端评阅进度(重构A):把「提交状态 × 评阅任务状态」折算成学生能看懂的一个阶段。
//
// 学生只需要四个词:排队中 / 评阅中 / 本次由老师评 / 已出分。内部机器状态(重试、退避、
// 死信)一概不透出——「评阅失败」对学生毫无行动价值还徒增焦虑,失败即转老师,是产品语义
// 不是故障语义。'none' = 这份提交没有在途的 AI 评阅可展示(客观题/投票、或已定稿),
// UI 维持原样不加进度条。
//
// 纯函数、无依赖:页面 Server Component(初始渲染)与轮询 server action 共用同一份口径,
// 两端永不各算各的。

export type GradingStage = 'queued' | 'running' | 'teacher' | 'done' | 'none'

export function gradingStage(
  subStatus: string | null | undefined,
  jobStatus: string | null | undefined,
): GradingStage {
  if (!subStatus) return 'none'
  // 已定稿(含 FLAGGED 待复核——分数已在,老师复核只会往上调):进度走完。
  if (subStatus === 'GRADED' || subStatus === 'FLAGGED') return 'done'
  if (subStatus === 'UPLOADED' || subStatus === 'PROCESSING' || subStatus === 'FAILED') {
    if (jobStatus === 'PENDING') return 'queued'
    if (jobStatus === 'PROCESSING') return 'running'
    // 任务死信(自动评阅放弃)→ 提交仍在老师队列(needsReview),对学生就是「老师评」。
    if (jobStatus === 'FAILED') return 'teacher'
    // 没有任务:提交自己卡在 PROCESSING/FAILED(评阅中途或已放弃)也归老师口径,
    // 免得学生盯着一个永远不动的「评阅中」;UPLOADED 且无任务 = 非 AI 评阅流(客观题/
    // 投票/纯待老师),维持原展示。任务 DONE 而提交没定稿 = 队列已结算无可评(如改型),
    // 同样交老师口径由既有文案兜底。
    if (subStatus === 'UPLOADED' && (jobStatus == null || jobStatus === 'DONE')) return 'none'
    return 'teacher'
  }
  return 'none'
}
