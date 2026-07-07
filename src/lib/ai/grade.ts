import { getModel } from './registry'
import { getPerceptionProvider, getJudgeProvider } from './adapters'
import { unavailable } from './errors'
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
  recitedText?: string
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
  if (!perceptionProvider) throw unavailable(`感知 provider 未实现: ${perceptionModel.provider}`)
  const judgeProvider = getJudgeProvider(judgeModel.provider)
  if (!judgeProvider) throw unavailable(`评分 provider 未实现: ${judgeModel.provider}`)

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
      recitedText: req.recitedText,
    },
    judgeModel.id,
  )

  return { perceptionModel: perceptionModel.id, judgeModel: judgeModel.id, perception, judge }
}

// ── Split stages (perceive / judge) ───────────────────────────────────────────
// Perception (the video call) is ~16× the judge cost, so a judge-only failure (e.g. the
// judge provider out of balance) must NOT discard — and re-bill — a successful perception.
// The orchestrator (domain/grading.ts) persists the perception between the two, and on retry
// reuses it via judgeForGrading, skipping the expensive re-perceive. gradeSubmission above
// stays as the combined one-shot for callers that don't need the split.

export interface PerceiveResult {
  perceptionModel: string
  perception: PerceptionResult
}

// Run ONLY the perception stage. Same validation as gradeSubmission's first half.
export async function perceiveForGrading(
  req: Pick<GradeRequest, 'perceptionModelId' | 'referenceSentences' | 'requireEyesClosed' | 'videoUrl' | 'audioUrl'>,
): Promise<PerceiveResult> {
  const perceptionModel = getModel(req.perceptionModelId)
  if (!perceptionModel) throw new Error(`未知的感知模型: ${req.perceptionModelId}`)
  if (!perceptionModel.capabilities.includes('perception')) {
    throw new Error(`模型 ${perceptionModel.label} 不能用于感知阶段`)
  }
  const perceptionProvider = getPerceptionProvider(perceptionModel.provider)
  if (!perceptionProvider) throw unavailable(`感知 provider 未实现: ${perceptionModel.provider}`)
  const perception = await perceptionProvider.perceive(
    { videoUrl: req.videoUrl, audioUrl: req.audioUrl, referenceSentences: req.referenceSentences, requireEyesClosed: req.requireEyesClosed },
    perceptionModel.id,
  )
  return { perceptionModel: perceptionModel.id, perception }
}

export interface JudgeStageResult {
  judgeModel: string
  judge: JudgeResult
}

// Run ONLY the judge stage against an already-obtained perception (fresh or cached).
export async function judgeForGrading(
  perception: PerceptionResult,
  req: Pick<GradeRequest, 'judgeModelId' | 'referenceSentences' | 'rubric' | 'maxScore' | 'recitedText'>,
): Promise<JudgeStageResult> {
  const judgeModel = getModel(req.judgeModelId)
  if (!judgeModel) throw new Error(`未知的评分模型: ${req.judgeModelId}`)
  if (!judgeModel.capabilities.includes('judge')) {
    throw new Error(`模型 ${judgeModel.label} 不能用于评分阶段`)
  }
  const judgeProvider = getJudgeProvider(judgeModel.provider)
  if (!judgeProvider) throw unavailable(`评分 provider 未实现: ${judgeModel.provider}`)
  const judge = await judgeProvider.judge(
    { perception, referenceSentences: req.referenceSentences, rubric: req.rubric, maxScore: req.maxScore, recitedText: req.recitedText },
    judgeModel.id,
  )
  return { judgeModel: judgeModel.id, judge }
}

export interface GradeWritingRequest {
  judgeModelId: string
  rubric: string
  maxScore: number
  studentText: string
  instructions?: string
  referenceSentences?: ReferenceSentence[]
}

export interface GradeWritingResult {
  judgeModel: string
  judge: JudgeResult
}

// Grade written text against a rubric — the writing path (自由文本 / 默写). No perception
// stage: one judge call. Throws a readable error if the model can't judge.
export async function gradeWriting(req: GradeWritingRequest): Promise<GradeWritingResult> {
  const judgeModel = getModel(req.judgeModelId)
  if (!judgeModel) throw new Error(`未知的评分模型: ${req.judgeModelId}`)
  if (!judgeModel.capabilities.includes('judge')) {
    throw new Error(`模型 ${judgeModel.label} 不能用于评分阶段`)
  }
  const judgeProvider = getJudgeProvider(judgeModel.provider)
  if (!judgeProvider) throw unavailable(`评分 provider 未实现: ${judgeModel.provider}`)

  const judge = await judgeProvider.judgeText(
    {
      studentText: req.studentText,
      rubric: req.rubric,
      maxScore: req.maxScore,
      instructions: req.instructions,
      referenceSentences: req.referenceSentences,
    },
    judgeModel.id,
  )
  return { judgeModel: judgeModel.id, judge }
}
