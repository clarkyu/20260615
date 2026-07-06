// 作业性质「四态」(docs/VISION.md §6 的 mode 层):作业 / 训练 / 测评 / 考试。
// 存库为机器值,显示经 i18n(`mode.${value}`)。纯常量、可测,无任何依赖。

export const ASSIGNMENT_MODES = ['HOMEWORK', 'TRAINING', 'ASSESSMENT', 'EXAM'] as const

export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number]

export function isAssignmentMode(v: unknown): v is AssignmentMode {
  return typeof v === 'string' && (ASSIGNMENT_MODES as readonly string[]).includes(v)
}
