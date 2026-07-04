// The single source of truth for an assignment 环节 (Phase)'s *type*.
//
// Historically a phase's type was never a stored field — it was re-derived, ad hoc,
// from a pile of `require*` booleans at every routing site (submit finish, poll vs
// single-choice, which grader runs). That "flag soup" made invalid combinations
// representable and every new type a new boolean threaded through every switch. This
// module centralizes the derivation into ONE function; the value is now also persisted
// on `Phase.itemType` (backfilled by migration 0042).
//
// The three values ARE today's three grading-routing outcomes — so routing on itemType
// is behaviour-identical to the old inline flag checks:
//   objective — 单选 / 投票（客观自动判分或纯计票；不走 AI、不进老师待批队列）
//   speech    — 录音 / 录像的口语类（朗读 / 背诵 / 模仿 / 口语 / 演讲）；走 感知 + 评分 AI 流水线
//   writing   — 打字默写 / 自由文本 / 手写（老师人工评，暂不走 AI）
//
// Relationship to the bank/curriculum taxonomy (`curriculum/taxonomy.ts`): this is the
// coarse *grading* discriminator that drives which grader runs, aligning with that
// module's `AssessmentMethod` (speech↔ai-speaking, objective↔objective, writing↔ai-text
// / ai-writing-rubric). It is deliberately coarser than that module's content-shape
// `ItemType` (recitation / shadowing / dialogue / listening / …), which is finer
// metadata on *bank items*, not a phase routing signal — kept separate so phase routing
// isn't coupled to bank content shape.
//
// IMPORTANT: keep the precedence below in exact lockstep with the SQL backfill in
// d1/migrations/0042_phase_item_type.sql — the stored column and this function must
// never disagree.

export type PhaseItemType = 'speech' | 'writing' | 'objective'

// The subset of a phase's submit-requirement flags the type is derived from. All
// optional so callers can pass a Prisma phase row, a submit `Requirements`, or a
// `PhaseInput` interchangeably.
export interface ItemTypeFlags {
  requireText?: boolean | null
  requireAudio?: boolean | null
  requireVideo?: boolean | null
  requireHandwriting?: boolean | null
  requireChoice?: boolean | null
  requireFreeText?: boolean | null
}

// Precedence mirrors the pre-existing routing exactly:
//   1. a choice-only phase (requireChoice, nothing else) → objective
//   2. otherwise any audio/video → speech (the perception+judge path)
//   3. everything else (text / handwriting / free-text) → writing (manual, no AI today)
// Mixed / invalid flag combos resolve by this precedence, same as the old code did.
export function phaseItemType(f: ItemTypeFlags): PhaseItemType {
  const choiceOnly =
    !!f.requireChoice &&
    !f.requireFreeText &&
    !f.requireText &&
    !f.requireAudio &&
    !f.requireVideo &&
    !f.requireHandwriting
  if (choiceOnly) return 'objective'
  if (f.requireAudio || f.requireVideo) return 'speech'
  return 'writing'
}
