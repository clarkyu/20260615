// 考试计时(SPEC §9.5 / 硬约束 6):以服务端 attempts.deadline_at 为准,客户端只显示。
// 超时 60 秒宽限后拒绝新的保存;逾期未交由工作线程自动提交。纯函数,表驱动测试。

export const SUBMIT_GRACE_MS = 60_000

/** 剩余毫秒(不为负;客户端显示用服务端时钟偏移校正后的 now)。 */
export function remainingMs(deadlineAt: Date, now: Date): number {
  return Math.max(0, deadlineAt.getTime() - now.getTime())
}

/** 已到时(到达即触发自动交卷)。 */
export function isExpired(deadlineAt: Date, now: Date): boolean {
  return now.getTime() >= deadlineAt.getTime()
}

/** 保存应被拒绝:已过截止 + 60 秒宽限(宽限期内仍接受,给弱网最后一批同步)。 */
export function isSaveRejected(deadlineAt: Date, now: Date): boolean {
  return now.getTime() > deadlineAt.getTime() + SUBMIT_GRACE_MS
}

/** 逾期未交、应由工作线程自动提交(与拒绝保存同界限)。 */
export function isOverdueForAutoSubmit(deadlineAt: Date, now: Date): boolean {
  return isSaveRejected(deadlineAt, now)
}
