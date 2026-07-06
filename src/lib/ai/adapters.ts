import type { PerceptionProvider, JudgeProvider, AuthorProvider, Provider } from './types'
import { geminiPerception, geminiJudge, geminiAuthor } from './providers/gemini'
import {
  qwenPerception,
  qwenJudge,
  qwenAuthor,
  minimaxJudge,
  minimaxAuthor,
  deepseekJudge,
  deepseekAuthor,
  openaiJudge,
  openaiAuthor,
} from './providers/openai-compat'
import { whisperPerception } from './providers/whisper'
import { claudeJudge, claudeAuthor } from './providers/anthropic'

// Every provider/stage is now a real adapter; the registry + orchestrator route each
// model to the right perception/judge implementation. Missing API keys degrade
// gracefully (each provider throws an `unavailable` sentinel the grading layer catches).

const perceptionProviders: Partial<Record<Provider, PerceptionProvider>> = {
  gemini: geminiPerception,
  qwen: qwenPerception,
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

// Authoring: Gemini reads the textbook photo inline; every text LLM handles the
// topic-only path. Whisper (transcription-only) is intentionally absent.
const authorProviders: Partial<Record<Provider, AuthorProvider>> = {
  gemini: geminiAuthor,
  qwen: qwenAuthor,
  minimax: minimaxAuthor,
  deepseek: deepseekAuthor,
  openai: openaiAuthor,
  claude: claudeAuthor,
}

export function getPerceptionProvider(provider: Provider): PerceptionProvider | undefined {
  return perceptionProviders[provider]
}

export function getJudgeProvider(provider: Provider): JudgeProvider | undefined {
  return judgeProviders[provider]
}

export function getAuthorProvider(provider: Provider): AuthorProvider | undefined {
  return authorProviders[provider]
}
