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
  requireFreeText: z.boolean().default(false),
  graded: z.boolean().default(true),
  maxAttempts: z.coerce.number().int().min(1).max(99).default(1),
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
