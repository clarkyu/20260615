import { z } from '@/lib/validate'

// The stored shape of an assignment template — the publish config minus the absolute
// open/due times (those are set fresh each publish). Parsed defensively from JSON.

export const templatePhaseSchema = z.object({
  title: z.string().default(''),
  category: z.string().default(''),
  instructions: z.string().default(''),
  useBankSet: z.boolean().default(false),
  sentences: z.string().default(''),
  requireEyesClosed: z.boolean().default(false),
  requireText: z.boolean().default(false),
  requireAudio: z.boolean().default(false),
  requireVideo: z.boolean().default(false),
  requireHandwriting: z.boolean().default(false),
  requireChoice: z.boolean().default(false),
  choicesJson: z.string().nullable().default(null),
  correctChoice: z.string().nullable().default(null),
  multiChoice: z.boolean().default(false),
  correctChoices: z.string().nullable().default(null),
  selectionMode: z.enum(['poll', 'theme', 'branch']).nullable().default(null),
  branchTopicsJson: z.string().nullable().default(null),
  fillBlank: z.boolean().default(false),
  blanksJson: z.string().nullable().default(null),
  requireFreeText: z.boolean().default(false),
  rubric: z.string().nullable().default(null),
  perceptionModel: z.string().nullable().default(null),
  judgeModel: z.string().nullable().default(null),
  graded: z.boolean().default(true),
  maxAttempts: z.coerce.number().int().min(1).max(99).default(1),
  weight: z.coerce.number().int().min(1).max(99).default(1),
  isFormalTest: z.boolean().default(false),
  freePractice: z.boolean().default(false),
})

export const templatePayloadSchema = z.object({
  title: z.string().default(''),
  monthLabel: z.string().default(''),
  chunkSetId: z.number().int().nullable().default(null),
  phases: z.array(templatePhaseSchema).min(1).max(20),
})

export type TemplatePayload = z.infer<typeof templatePayloadSchema>
export type TemplatePhase = z.infer<typeof templatePhaseSchema>

export function parseTemplatePayload(json: string): TemplatePayload | null {
  try {
    const p = templatePayloadSchema.safeParse(JSON.parse(json))
    return p.success ? p.data : null
  } catch {
    return null
  }
}

// The source shape buildTemplatePayload maps from — structurally satisfied by the domain
// PhaseDraft, kept structural so this stays in lib (no domain import / layering inversion).
export interface TemplateSourcePhase {
  title: string | null
  category: string | null
  instructions: string | null
  useBankSet: boolean
  typedSentences: string[]
  requireEyesClosed: boolean
  requireText: boolean
  requireAudio: boolean
  requireVideo: boolean
  requireHandwriting: boolean
  requireChoice?: boolean
  choicesJson?: string | null
  correctChoice?: string | null
  multiChoice?: boolean
  correctChoices?: string | null
  selectionMode?: string | null
  branchTopicsJson?: string | null
  fillBlank?: boolean
  blanksJson?: string | null
  requireFreeText?: boolean
  rubric?: string | null
  perceptionModel?: string | null
  judgeModel?: string | null
  graded: boolean
  maxAttempts: number
  weight: number
  isFormalTest: boolean
  freePractice: boolean
}

// Build the stored template payload from a publish config. The single source of truth
// for the payload shape — every phase field the template must round-trip is written here
// (regression guard: 单选/自由文本 fields — requireChoice/choicesJson/correctChoice/
// requireFreeText — were previously dropped, silently losing those phase types on reuse).
export function buildTemplatePayload(
  meta: { title: string; monthLabel: string | null },
  phases: TemplateSourcePhase[],
  chunkSetId: number | null,
): TemplatePayload {
  return {
    title: meta.title,
    monthLabel: meta.monthLabel ?? '',
    chunkSetId,
    phases: phases.map((p) => ({
      title: p.title ?? '',
      category: p.category ?? '',
      instructions: p.instructions ?? '',
      useBankSet: p.useBankSet,
      sentences: p.typedSentences.join('\n'),
      requireEyesClosed: p.requireEyesClosed,
      requireText: p.requireText,
      requireAudio: p.requireAudio,
      requireVideo: p.requireVideo,
      requireHandwriting: p.requireHandwriting,
      requireChoice: p.requireChoice ?? false,
      choicesJson: p.choicesJson ?? null,
      correctChoice: p.correctChoice ?? null,
      multiChoice: p.multiChoice ?? false,
      correctChoices: p.correctChoices ?? null,
      selectionMode: (p.selectionMode as 'poll' | 'theme' | 'branch' | null) ?? null,
      branchTopicsJson: p.branchTopicsJson ?? null,
      fillBlank: p.fillBlank ?? false,
      blanksJson: p.blanksJson ?? null,
      requireFreeText: p.requireFreeText ?? false,
      rubric: p.rubric ?? null,
      perceptionModel: p.perceptionModel ?? null,
      judgeModel: p.judgeModel ?? null,
      graded: p.graded,
      maxAttempts: p.maxAttempts,
      weight: p.weight,
      isFormalTest: p.isFormalTest,
      freePractice: p.freePractice,
    })),
  }
}
