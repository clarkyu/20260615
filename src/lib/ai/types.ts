// Capability-tagged AI model registry + two-stage grading contracts.
//
// Stage ① perception: video/audio -> transcript + pronunciation impression +
//                      anti-cheat observations. Needs a multimodal/ASR model.
// Stage ② judging:    transcript + rubric + reference -> score + feedback.
//                      Any text LLM (incl. DeepSeek) can do this.

export type Provider = 'gemini' | 'qwen' | 'minimax' | 'openai' | 'deepseek' | 'claude' | 'whisper'

export type Capability = 'perception' | 'judge'

export interface ModelDescriptor {
  id: string // stable id used in DB + selectors, e.g. "gemini-2.5-flash"
  label: string // human label shown to teachers
  provider: Provider
  capabilities: Capability[]
  // Which media the perception stage can consume directly.
  modalities: Array<'video' | 'audio' | 'image' | 'text'>
  note?: string
}

export interface ReferenceSentence {
  order: number
  text: string
}

export interface PerceptionInput {
  videoUrl?: string // presigned URL to the student's recording
  audioUrl?: string
  referenceSentences: ReferenceSentence[]
  requireEyesClosed: boolean
}

export interface PerceptionObservation {
  eyesClosed?: boolean
  readingSuspected?: boolean
  facePresent?: boolean
  continuousTake?: boolean
  notes?: string
}

export interface PerSentenceResult {
  order: number
  spokenText: string
  completeness: number // 0..1
  accuracy: number // 0..1
}

// Real token usage reported by the provider for ONE API call (input=prompt tokens,
// output=completion tokens). Optional: whisper (per-minute) and any provider that
// doesn't surface usage leave it undefined. Captured so real spend is observable
// instead of only estimated — it rides along in the persisted aiResult.
export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface PerceptionResult {
  transcript: string
  perSentence: PerSentenceResult[]
  pronunciationImpression?: string
  observations: PerceptionObservation
  usage?: TokenUsage
  raw?: unknown
}

export interface JudgeInput {
  perception: PerceptionResult
  referenceSentences: ReferenceSentence[]
  rubric: string
  maxScore: number
  // Step 1: the text the student wrote from memory (optional).
  recitedText?: string
}

// Writing (text-only) grading: the student submitted written text (自由文本 / 默写),
// graded against the teacher's rubric with NO speech-perception stage. Any judge model
// (a text LLM) can do it — same JudgeResult shape as the speech judge.
export interface TextJudgeInput {
  studentText: string
  rubric: string
  maxScore: number
  // What the student was asked to write (the phase instructions), for context.
  instructions?: string
  // Optional model/reference lines (e.g. a 默写 phase's target sentences); absent for
  // open-ended writing.
  referenceSentences?: ReferenceSentence[]
}

export interface JudgeResult {
  score: number // 0..maxScore
  breakdown?: Record<string, number>
  feedback: string // detailed, learner-facing (Chinese)
  // Model's self-rated certainty (0..1). Drives "AI-first grading": high-confidence
  // clean submissions can skip the teacher queue; everything else is reviewed.
  confidence?: number
  usage?: TokenUsage
  raw?: unknown
}

export interface PerceptionProvider {
  perceive(input: PerceptionInput, modelId: string): Promise<PerceptionResult>
}

export interface JudgeProvider {
  judge(input: JudgeInput, modelId: string): Promise<JudgeResult>
  // Grade written text against a rubric (no perception stage). Same result shape.
  judgeText(input: TextJudgeInput, modelId: string): Promise<JudgeResult>
}
