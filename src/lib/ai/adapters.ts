import type { PerceptionProvider, JudgeProvider, Provider } from './types'
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
import { claudeJudge } from './providers/anthropic'

// Every provider/stage is now a real adapter; the registry + orchestrator route each
// model to the right perception/judge implementation. Missing API keys degrade
// gracefully (each provider throws an `unavailable` sentinel the grading layer catches).

const perceptionProviders: Partial<Record<Provider, PerceptionProvider>> = {
  gemini: geminiPerception,
  qwen: qwenPerception,
  openai: openaiPerception,
  whisper: whisperPerception,
}

const judgeProviders: Partial<Record<Provider, JudgeProvider>> = {
  gemini: geminiJudge,
  qwen: qwenJudge,
  minimax: minimaxJudge,
  deepseek: deepseekJudge,
  openai: openaiJudge,
  claude: claudeJudge,
}

export function getPerceptionProvider(provider: Provider): PerceptionProvider | undefined {
  return perceptionProviders[provider]
}

export function getJudgeProvider(provider: Provider): JudgeProvider | undefined {
  return judgeProviders[provider]
}
