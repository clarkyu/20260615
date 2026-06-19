import type {
  JudgeInput,
  JudgeResult,
  PerceptionProvider,
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
import { whisperPerception } from './providers/whisper'

// ─────────────────────────────────────────────────────────────────────────────
// STUB judge adapter. Returns a deterministic mock so the full grading flow works
// end to end before the Claude judge is wired. The registry + orchestrator already
// route to the right provider/stage.
// ─────────────────────────────────────────────────────────────────────────────

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
      // Confidence tracks how cleanly the perception matched the reference.
      confidence: Math.max(0, Math.min(1, avg)),
    }
  }
}

const perceptionProviders: Partial<Record<Provider, PerceptionProvider>> = {
  // Real adapters:
  gemini: geminiPerception,
  qwen: qwenPerception,
  openai: openaiPerception,
  whisper: whisperPerception,
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
