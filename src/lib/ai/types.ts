// Capability-tagged AI model registry + two-stage grading contracts.
//
// Stage ① perception: video/audio -> transcript + pronunciation impression +
//                      anti-cheat observations. Needs a multimodal/ASR model.
// Stage ② judging:    transcript + rubric + reference -> score + feedback.
//                      Any text LLM (incl. DeepSeek) can do this.

export type Provider = 'gemini' | 'qwen' | 'minimax' | 'openai' | 'deepseek' | 'claude' | 'whisper'

// Stage ③ authoring (备课出题): a teacher's topic and/or textbook photo -> a draft
//                      assignment. Text-only models handle the topic path; the
//                      photo path needs a multimodal model (routed to Gemini).
export type Capability = 'perception' | 'judge' | 'author'

export interface ModelDescriptor {
  id: string // stable id used in DB + selectors, e.g. "gemini-2.5-flash"
  label: string // human label shown to teachers
  provider: Provider
  capabilities: Capability[]
  // Which media the perception stage can consume directly.
  modalities: Array<'video' | 'audio' | 'image' | 'text'>
  // Reasoning/thinking model (chain-of-thought before answering). For DeepSeek this is
  // inherent to the model id (the Pro/reasoner tier). Drives the "推理" label; also the
  // hook if a provider ever needs a per-request thinking toggle.
  reasoning?: boolean
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

// ── Authoring (备课出题) ──────────────────────────────────────────────────────
// Draft an assignment from a teacher's brief and/or a textbook photo. The topic
// path is a plain text task any judge-grade LLM can do (DeepSeek by default); the
// photo path needs a multimodal model, so it's routed to Gemini.
export interface AuthorInput {
  topic: string
  imageBase64?: string
  imageMime?: string
}

export interface AuthorDraft {
  title: string
  category: string
  instructions: string
  sentences: string[]
}

export interface PerceptionProvider {
  perceive(input: PerceptionInput, modelId: string): Promise<PerceptionResult>
}

export interface AuthorProvider {
  author(input: AuthorInput, modelId: string): Promise<AuthorDraft>
}

export interface JudgeProvider {
  judge(input: JudgeInput, modelId: string): Promise<JudgeResult>
  // Grade written text against a rubric (no perception stage). Same result shape.
  judgeText(input: TextJudgeInput, modelId: string): Promise<JudgeResult>
}
