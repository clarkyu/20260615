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

export interface PerceptionResult {
  transcript: string
  perSentence: PerSentenceResult[]
  pronunciationImpression?: string
  observations: PerceptionObservation
  raw?: unknown
}

export interface JudgeInput {
  perception: PerceptionResult
  referenceSentences: ReferenceSentence[]
  rubric: string
  maxScore: number
}

export interface JudgeResult {
  score: number // 0..maxScore
  breakdown?: Record<string, number>
  feedback: string // detailed, learner-facing (Chinese)
  raw?: unknown
}

export interface PerceptionProvider {
  perceive(input: PerceptionInput, modelId: string): Promise<PerceptionResult>
}

export interface JudgeProvider {
  judge(input: JudgeInput, modelId: string): Promise<JudgeResult>
}
