import { getModel } from './registry'
import { getPerceptionProvider, getJudgeProvider } from './adapters'
import type { JudgeResult, PerceptionResult, ReferenceSentence } from './types'

export interface GradeRequest {
  perceptionModelId: string
  judgeModelId: string
  rubric: string
  maxScore: number
  referenceSentences: ReferenceSentence[]
  requireEyesClosed: boolean
  videoUrl?: string
  audioUrl?: string
}

export interface GradeResult {
  perceptionModel: string
  judgeModel: string
  perception: PerceptionResult
  judge: JudgeResult
}

// Validates the chosen models against their stage capabilities, then runs
// perception → judging. Throws a readable error if a model can't do its stage.
export async function gradeSubmission(req: GradeRequest): Promise<GradeResult> {
  const perceptionModel = getModel(req.perceptionModelId)
  if (!perceptionModel) throw new Error(`未知的感知模型: ${req.perceptionModelId}`)
  if (!perceptionModel.capabilities.includes('perception')) {
    throw new Error(`模型 ${perceptionModel.label} 不能用于感知阶段`)
  }

  const judgeModel = getModel(req.judgeModelId)
  if (!judgeModel) throw new Error(`未知的评分模型: ${req.judgeModelId}`)
  if (!judgeModel.capabilities.includes('judge')) {
    throw new Error(`模型 ${judgeModel.label} 不能用于评分阶段`)
  }

  const perceptionProvider = getPerceptionProvider(perceptionModel.provider)
  if (!perceptionProvider) throw new Error(`感知 provider 未实现: ${perceptionModel.provider}`)
  const judgeProvider = getJudgeProvider(judgeModel.provider)
  if (!judgeProvider) throw new Error(`评分 provider 未实现: ${judgeModel.provider}`)

  const perception = await perceptionProvider.perceive(
    {
      videoUrl: req.videoUrl,
      audioUrl: req.audioUrl,
      referenceSentences: req.referenceSentences,
      requireEyesClosed: req.requireEyesClosed,
    },
    perceptionModel.id,
  )

  const judge = await judgeProvider.judge(
    {
      perception,
      referenceSentences: req.referenceSentences,
      rubric: req.rubric,
      maxScore: req.maxScore,
    },
    judgeModel.id,
  )

  return { perceptionModel: perceptionModel.id, judgeModel: judgeModel.id, perception, judge }
}
