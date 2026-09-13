// 裸模块名而非 node: 前缀:instrumentation 的 edge 编译会把它按 next.config 的别名置空。
import { createHash } from 'crypto'
import { normalizeAnswerForCache } from '@/lib/grading/ai-postprocess'

/** 缓存键(SPEC §5.3):小题 + 规范化答案 + 提示词版本;任一变化即视为新答案。 */
export function answerHash(itemId: string, studentAnswer: string, promptVersion: string): string {
  return createHash('sha256').update(`${itemId}\n${promptVersion}\n${normalizeAnswerForCache(studentAnswer)}`).digest('hex')
}
