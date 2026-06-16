// ─────────────────────────────────────────────────────────────────────────────
// Curriculum taxonomy — the canonical, subject-agnostic "spine" every bank item
// references. English is the first populated subject; the shape is built so other
// subjects (语文 …) and other English skills (vocab/grammar/reading/listening/
// writing) are just more DATA, not a schema change.
//
// Design tenets encoded here:
//  · CEFR is the primary proficiency spine (extended Pre-A1 … C2+); CSE / ACTFL are
//    secondary cross-walks stored as data.
//  · Content is L1-agnostic; per-mother-tongue difficulty is an overlay (l1Trouble).
//  · Content (target English) is separate from scaffolding (localizable instructions
//    / glosses), so the bank works for learners worldwide.
// ─────────────────────────────────────────────────────────────────────────────

export type SubjectId = 'english' // future: 'chinese' | 'math' | …

export interface Subject {
  id: SubjectId
  label: string
  labelEn: string
}

export const SUBJECTS: Subject[] = [{ id: 'english', label: '英语', labelEn: 'English' }]

// Skill strands form a tree. `id` is a dot-path: subject.skill[.substrand].
export interface Strand {
  id: string
  subject: SubjectId
  parent?: string
  label: string
  labelEn: string
}

export const STRANDS: Strand[] = [
  { id: 'english.speaking', subject: 'english', label: '口语', labelEn: 'Speaking' },
  { id: 'english.speaking.pronunciation', subject: 'english', parent: 'english.speaking', label: '发音', labelEn: 'Pronunciation' },
  { id: 'english.speaking.shadowing', subject: 'english', parent: 'english.speaking', label: '跟读', labelEn: 'Shadowing' },
  { id: 'english.speaking.recitation', subject: 'english', parent: 'english.speaking', label: '背诵', labelEn: 'Recitation' },
  { id: 'english.speaking.dialogue', subject: 'english', parent: 'english.speaking', label: '对话', labelEn: 'Dialogue' },
  { id: 'english.speaking.speech', subject: 'english', parent: 'english.speaking', label: '演讲表达', labelEn: 'Speech' },
  { id: 'english.vocabulary', subject: 'english', label: '词汇', labelEn: 'Vocabulary' },
  { id: 'english.grammar', subject: 'english', label: '语法', labelEn: 'Grammar' },
  { id: 'english.reading', subject: 'english', label: '阅读', labelEn: 'Reading' },
  { id: 'english.listening', subject: 'english', label: '听力', labelEn: 'Listening' },
  { id: 'english.writing', subject: 'english', label: '写作', labelEn: 'Writing' },
]
export const STRAND_IDS = STRANDS.map((s) => s.id)

// ── Proficiency: CEFR primary spine (extended both ends) ─────────────────────
export type CefrBand = 'pre-a1' | 'a1' | 'a2' | 'b1' | 'b2' | 'c1' | 'c2' | 'c2-plus'

export const CEFR_LEVELS: { band: CefrBand; ordinal: number; label: string; note: string }[] = [
  { band: 'pre-a1', ordinal: 0, label: 'Pre-A1', note: '启蒙 · 字母/拼读/前识字' },
  { band: 'a1', ordinal: 1, label: 'A1', note: '入门' },
  { band: 'a2', ordinal: 2, label: 'A2', note: '基础' },
  { band: 'b1', ordinal: 3, label: 'B1', note: '进阶' },
  { band: 'b2', ordinal: 4, label: 'B2', note: '中高级' },
  { band: 'c1', ordinal: 5, label: 'C1', note: '高级' },
  { band: 'c2', ordinal: 6, label: 'C2', note: '精通' },
  { band: 'c2-plus', ordinal: 7, label: 'C2+', note: '母语级精修 · 语域/口音' },
]
export const CEFR_BANDS = CEFR_LEVELS.map((l) => l.band)

// Secondary cross-walks (approximate alignment ranges, stored as data — verify
// against each framework's official alignment study before publishing claims).
export const CROSSWALK: Record<CefrBand, { cse?: string; actfl?: string }> = {
  'pre-a1': { cse: 'CSE 1', actfl: 'Novice Low' },
  a1: { cse: 'CSE 1–2', actfl: 'Novice Mid–High' },
  a2: { cse: 'CSE 3', actfl: 'Intermediate Low–Mid' },
  b1: { cse: 'CSE 4', actfl: 'Intermediate Mid–High' },
  b2: { cse: 'CSE 5–6', actfl: 'Advanced Low–Mid' },
  c1: { cse: 'CSE 7–8', actfl: 'Advanced High–Superior' },
  c2: { cse: 'CSE 9', actfl: 'Superior' },
  'c2-plus': { cse: 'CSE 9+', actfl: 'Distinguished' },
}

// ── Content domains (general first; professional branches need real majors) ──
export const DOMAINS = [
  { id: 'general', label: '通用', subThemes: ['日常生活', '社交', '校园', '出行', '健康', '科技', '文化'] },
  { id: 'academic', label: '学术/专业', subThemes: [] },
  { id: 'industry', label: '行业', subThemes: [] },
  { id: 'occupational', label: '职场', subThemes: ['求职', '会议', '客户', '电话', '邮件口语'] },
] as const
export const DOMAIN_IDS = DOMAINS.map((d) => d.id)

// ── L1 overlays: mother-tongues we author contrastive difficulty notes for ───
export interface L1 {
  code: string
  label: string
  labelEn: string
  supported: boolean // authored overlays exist
}
export const L1S: L1[] = [
  { code: 'zh', label: '中文', labelEn: 'Chinese', supported: true },
  { code: 'es', label: '西班牙语', labelEn: 'Spanish', supported: true },
  { code: 'ar', label: '阿拉伯语', labelEn: 'Arabic', supported: false },
  { code: 'ja', label: '日语', labelEn: 'Japanese', supported: false },
  { code: 'ko', label: '韩语', labelEn: 'Korean', supported: false },
  { code: 'fr', label: '法语', labelEn: 'French', supported: false },
  { code: 'pt', label: '葡萄牙语', labelEn: 'Portuguese', supported: false },
  { code: 'hi', label: '印地语', labelEn: 'Hindi', supported: false },
]
export const L1_CODES = L1S.map((l) => l.code)

// ── How an item is graded (drives engine routing) ───────────────────────────
export type AssessmentMethod = 'ai-speaking' | 'ai-text' | 'objective' | 'ai-writing-rubric'

export type ItemType =
  | 'pronunciation-drill'
  | 'shadowing'
  | 'recitation'
  | 'dialogue'
  | 'speech'
  | 'vocab'
  | 'grammar'
  | 'reading'
  | 'listening'
  | 'writing'

// Phonological feature tags — let the pronunciation/shadowing bank give SYSTEMATIC
// coverage (and power L1-targeted drilling) instead of random sentences.
export const PHONO_FEATURES = [
  // segmental
  'letter-sound', 'vowel-length', 'th-fricatives', 'v-w', 'l-n', 'r-l',
  'final-consonants', 'consonant-clusters', 'voicing',
  // suprasegmental
  'word-stress', 'sentence-stress', 'rhythm', 'intonation-fall', 'intonation-rise',
  'linking', 'weak-forms', 'elision', 'emphatic-stress',
] as const

// Shared metadata carried by EVERY bank item, regardless of payload type.
export interface ItemMeta {
  id: string
  subject: SubjectId
  strand: string
  itemType: ItemType
  cefr: CefrBand
  domain: string
  subTheme?: string
  canDo: string // the function / can-do objective this item serves
  tags: string[] // construct/feature tags (phono features, grammar point, …)
  l1Trouble?: { l1: string; note: string }[]
  assessment: AssessmentMethod
  source: string
  status: 'draft' | 'review' | 'published'
}

// ── helpers ──────────────────────────────────────────────────────────────────
export function isCefrBand(x: string): x is CefrBand {
  return (CEFR_BANDS as string[]).includes(x)
}
export function crosswalkFor(band: CefrBand) {
  return CROSSWALK[band]
}
export function strandExists(id: string): boolean {
  return STRAND_IDS.includes(id)
}
