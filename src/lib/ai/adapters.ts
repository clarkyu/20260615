import type {
  JudgeInput,
  JudgeResult,
  PerceptionInput,
  PerceptionProvider,
  PerceptionResult,
  JudgeProvider,
  Provider,
} from './types'
import { geminiPerception, geminiJudge } from './providers/gemini'
import {
  qwenPerception,
  qwenJudge,
  minimaxJudge,
  deepseekJudge,
  openaiPerception,
  openaiJudge,
} from './providers/openai-compat'

// ─────────────────────────────────────────────────────────────────────────────
// STUB adapters. These return deterministic mock results so the full grading
// flow (queue → perceive → judge → store → review) works end to end before any
// real API keys are wired. Each provider gets its own real implementation later;
// the registry + orchestrator already route to the right provider/stage.
// ─────────────────────────────────────────────────────────────────────────────

class StubPerception implements PerceptionProvider {
  constructor(private readonly provider: Provider) {}

  async perceive(input: PerceptionInput, modelId: string): Promise<PerceptionResult> {
    const perSentence = input.referenceSentences.map((s) => ({
      order: s.order,
      spokenText: s.text,
      completeness: 1,
      accuracy: 0.9,
    }))
    return {
      transcript: input.referenceSentences.map((s) => s.text).join(' '),
      perSentence,
      pronunciationImpression: `[stub:${this.provider}/${modelId}] 发音清晰、流利度尚可（占位）`,
      observations: {
        eyesClosed: input.requireEyesClosed ? true : undefined,
        readingSuspected: false,
        facePresent: true,
        continuousTake: true,
        notes: '占位感知结果，待接入真实模型。',
      },
    }
  }
}

class StubJudge implements JudgeProvider {
  constructor(private readonly provider: Provider) {}

  async judge(input: JudgeInput, modelId: string): Promise<JudgeResult> {
    const avg =
      input.perception.perSentence.reduce((acc, s) => acc + (s.completeness + s.accuracy) / 2, 0) /
      Math.max(input.perception.perSentence.length, 1)
    const score = Math.round(avg * input.maxScore)
    return {
      score,
      breakdown: { 完整度: Math.round(avg * input.maxScore * 0.5), 准确度: Math.round(avg * input.maxScore * 0.5) },
      feedback: `[stub:${this.provider}/${modelId}] 依据评分标准给出占位评语：背诵较完整，建议加强个别句子的发音与连读。`,
    }
  }
}

const perceptionProviders: Partial<Record<Provider, PerceptionProvider>> = {
  // Real adapters:
  gemini: geminiPerception,
  qwen: qwenPerception,
  openai: openaiPerception,
  // Stub (to be implemented):
  whisper: new StubPerception('whisper'),
}

const judgeProviders: Partial<Record<Provider, JudgeProvider>> = {
  // Real adapters:
  gemini: geminiJudge,
  qwen: qwenJudge,
  minimax: minimaxJudge,
  deepseek: deepseekJudge,
  openai: openaiJudge,
  // Stub (to be implemented):
  claude: new StubJudge('claude'),
}

export function getPerceptionProvider(provider: Provider): PerceptionProvider | undefined {
  return perceptionProviders[provider]
}

export function getJudgeProvider(provider: Provider): JudgeProvider | undefined {
  return judgeProviders[provider]
}
