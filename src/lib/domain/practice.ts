// Practice domain service.
//
// A practice round runs the same AI pipeline as grading but is throwaway from the
// grade's perspective: it never touches the Submission/attempt count. It exists to
// give the learner instant, formative feedback so they can improve *before* the
// real submission. Degrades gracefully when no model key is configured.

import { gradeSubmission, type GradeResult } from '@/lib/ai/grade'
import { logError } from '../log'
import { DEFAULT_MAX_SCORE, isUnavailable } from './grading'

export interface PracticeGradeInput {
  perceptionModel: string
  judgeModel: string
  rubric: string
  referenceSentences: { order: number; text: string }[]
  audioUrl?: string
  recitedText?: string
}

export type PracticeOutcome =
  | { status: 'graded'; result: GradeResult }
  // No model API key configured yet — caller shows a friendly placeholder.
  | { status: 'unavailable' }
  | { status: 'error'; message: string }

export async function gradePractice(input: PracticeGradeInput): Promise<PracticeOutcome> {
  try {
    const result = await gradeSubmission({
      perceptionModelId: input.perceptionModel,
      judgeModelId: input.judgeModel,
      rubric: input.rubric,
      maxScore: DEFAULT_MAX_SCORE,
      referenceSentences: input.referenceSentences,
      // Practice is for the learner's own benefit — no anti-cheat pressure.
      requireEyesClosed: false,
      audioUrl: input.audioUrl,
      recitedText: input.recitedText,
    })
    return { status: 'graded', result }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'practice grade failed'
    if (isUnavailable(message)) return { status: 'unavailable' }
    logError('gradePractice', 'failed', err)
    return { status: 'error', message }
  }
}
