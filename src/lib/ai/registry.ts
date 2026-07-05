import type { Capability, ModelDescriptor, Provider } from './types'

// The catalogue of models teachers can pick from. `id` is the actual API model
// name sent to the provider. Capability + modality tags drive which stage each
// model is eligible for; adapters are wired per provider in ./adapters.
export const MODELS: ModelDescriptor[] = [
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash（视频+音频，一把梭）',
    provider: 'gemini',
    capabilities: ['perception', 'judge', 'author'],
    modalities: ['video', 'audio', 'image', 'text'],
    note: '原生吃视频+音频，最省事；跑量首选。也是拍课本照片出题的默认模型。',
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro（难例复核）',
    provider: 'gemini',
    capabilities: ['perception', 'judge', 'author'],
    modalities: ['video', 'audio', 'image', 'text'],
  },
  {
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash（预览·中间价位）',
    provider: 'gemini',
    capabilities: ['perception', 'judge', 'author'],
    modalities: ['video', 'audio', 'image', 'text'],
    note: '预览版，比 3.5 Flash 便宜（约 $0.50/$3）；想升级又想控成本时用。',
  },
  {
    id: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash（最新·视频+音频·跑量首选）',
    provider: 'gemini',
    capabilities: ['perception', 'judge', 'author'],
    modalities: ['video', 'audio', 'image', 'text'],
    note: '最新稳定版 Flash，原生吃视频+音频；日常批改首选。',
  },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro（预览·难例复核）',
    provider: 'gemini',
    capabilities: ['perception', 'judge', 'author'],
    modalities: ['video', 'audio', 'image', 'text'],
    note: '预览版，能力最强；留给难例复核。',
  },
  {
    id: 'qwen-omni-turbo',
    label: '通义千问 Qwen-Omni（音频/视频+文本）',
    provider: 'qwen',
    capabilities: ['perception', 'judge', 'author'],
    modalities: ['video', 'audio', 'image', 'text'],
    note: '国内账号好申请。',
  },
  {
    id: 'MiniMax-Text-01',
    label: 'MiniMax（文本评分/出题）',
    provider: 'minimax',
    capabilities: ['judge', 'author'],
    modalities: ['text'],
    note: '纯文本评分/出题，配合感知模型用。',
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o（音频+抽帧）',
    provider: 'openai',
    capabilities: ['perception', 'judge', 'author'],
    modalities: ['audio', 'image', 'text'],
  },
  {
    id: 'whisper-1',
    label: 'Whisper（转写兜底）',
    provider: 'whisper',
    capabilities: ['perception'],
    modalities: ['audio'],
    note: '只转写，发音分弱；配合文本评分模型用。',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro（推理·按标准精评）',
    provider: 'deepseek',
    capabilities: ['judge'],
    modalities: ['text'],
    reasoning: true,
    note: '系统默认评分模型。V4 Pro 推理版（开启思考链），纯文本；先想后判，按评分标准精细打分与写评语。感知阶段仍需多模态模型（如 Gemini）。',
  },
  {
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash（评分/出题·更省）',
    provider: 'deepseek',
    capabilities: ['judge', 'author'],
    modalities: ['text'],
    note: '纯文本，做评分与文字出题；备课出题默认，跑量更省。deepseek-chat 的继任者。',
  },
  {
    id: 'claude-opus-4-8',
    label: 'Claude（精细评分+评语）',
    provider: 'claude',
    capabilities: ['judge', 'author'],
    modalities: ['text', 'image'],
  },
]

export interface Preset {
  id: string
  label: string
  perceptionModel: string
  judgeModel: string
}

// One-click combinations surfaced in the grading UI; teachers can still pick
// the two stages independently in "advanced" mode.
export const PRESETS: Preset[] = [
  { id: 'gemini-deepseek-pro', label: 'Gemini 感知 + DeepSeek V4 Pro 评分（默认·推理）', perceptionModel: 'gemini-3.5-flash', judgeModel: 'deepseek-v4-pro' },
  { id: 'gemini35-allinone', label: 'Gemini 3.5 一把梭（最省事）', perceptionModel: 'gemini-3.5-flash', judgeModel: 'gemini-3.5-flash' },
  { id: 'gemini-allinone', label: 'Gemini 2.5 一把梭（更省）', perceptionModel: 'gemini-2.5-flash', judgeModel: 'gemini-2.5-flash' },
  { id: 'qwen-allinone', label: 'Qwen 一把梭', perceptionModel: 'qwen-omni-turbo', judgeModel: 'qwen-omni-turbo' },
  { id: 'qwen-minimax', label: 'Qwen 感知 + MiniMax 评分', perceptionModel: 'qwen-omni-turbo', judgeModel: 'MiniMax-Text-01' },
  { id: 'whisper-deepseek', label: 'Whisper 感知 + DeepSeek 评分', perceptionModel: 'whisper-1', judgeModel: 'deepseek-v4-flash' },
  { id: 'gemini-claude', label: 'Gemini 感知 + Claude 评分', perceptionModel: 'gemini-2.5-flash', judgeModel: 'claude-opus-4-8' },
]

// Sensible default pairing when an assignment hasn't pinned its own models.
// Perception (吃视频/音频，多模态) 默认 Gemini 3.5 Flash。评分(judge) 默认 DeepSeek V4 Pro
// 推理版：先想后判、按评分标准精评。DeepSeek 只做文本评分,故感知仍走 Gemini。老师仍可在
// 评分页按环节改。写作(纯文本评)与口语(Gemini 感知 → DeepSeek 评)都吃这个默认评分模型。
export const DEFAULT_PERCEPTION_MODEL = 'gemini-3.5-flash'
export const DEFAULT_JUDGE_MODEL = 'deepseek-v4-pro'
// Authoring (备课出题):
//  · text/topic path → DeepSeek by default (cheap, capable at this text task; "让
//    DeepSeek 做默认能做的"). Teachers can pick any author-capable model per draft.
//  · textbook-photo path → needs a multimodal model, so it's routed to Gemini
//    regardless of the text pick (see resolveAuthorModel).
export const DEFAULT_AUTHOR_MODEL = 'deepseek-v4-flash'
export const DEFAULT_AUTHOR_IMAGE_MODEL = 'gemini-2.5-flash'

// ── teacher-facing catalogue metadata (用户中心：各家·使用范围·价格) ──

export const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: 'Google · Gemini',
  qwen: '阿里 · 通义千问',
  openai: 'OpenAI',
  claude: 'Anthropic · Claude',
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  whisper: 'OpenAI · Whisper',
}

// Which runtime secret each provider's key comes from (used by the catalogue +,
// later, by per-teacher BYOK key storage).
export const PROVIDER_KEY_ENV: Record<Provider, string> = {
  gemini: 'GEMINI_API_KEY',
  qwen: 'QWEN_API_KEY',
  openai: 'OPENAI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  whisper: 'OPENAI_API_KEY',
}

// BYOK credential slots a teacher can fill (deduped — OpenAI + Whisper share one
// key). `id` is stored in the AiKey table; `models` lists which providers it powers.
export const CREDENTIAL_SLOTS: { id: string; label: string; providers: Provider[]; help: string }[] = [
  { id: 'gemini', label: 'Google · Gemini', providers: ['gemini'], help: '用于 Gemini 各款（推荐，吃视频+音频）' },
  { id: 'qwen', label: '阿里 · 通义千问', providers: ['qwen'], help: 'DashScope key，用于 Qwen-Omni 等' },
  { id: 'openai', label: 'OpenAI', providers: ['openai', 'whisper'], help: '用于 GPT-4o 与 Whisper 转写' },
  { id: 'claude', label: 'Anthropic · Claude', providers: ['claude'], help: '纯文本评分' },
  { id: 'deepseek', label: 'DeepSeek', providers: ['deepseek'], help: '纯文本评分' },
  { id: 'minimax', label: 'MiniMax', providers: ['minimax'], help: '纯文本评分' },
]
export const CREDENTIAL_SLOT_IDS = CREDENTIAL_SLOTS.map((s) => s.id)

// Rough list price (per 1M tokens unless noted) — display only; prices change, so
// verify on each provider's site. Mixed USD/¥ matching each provider's native unit.
export const MODEL_PRICING: Record<string, string> = {
  'gemini-2.5-flash': '输入 $0.30（文/图/视频）· $1.0（音频）｜ 输出 $2.50',
  'gemini-3-flash-preview': '输入 $0.50（文/图/视频）· $1.0（音频）｜ 输出 $3.00',
  'gemini-3.5-flash': '输入 $1.50 ｜ 输出 $9.00',
  'gemini-2.5-pro': '输入 $1.25–2.50 ｜ 输出 $10–15',
  'gemini-3.1-pro-preview': '输入 $2–4 ｜ 输出 $12–18',
  'qwen-omni-turbo': '约 ¥0.3 起（输入）/ ¥0.6 起（输出）· 以阿里控制台为准',
  'gpt-4o': '约 $2.50（输入）｜ 输出 $10 · 旧款，需核对',
  'claude-opus-4-8': '输入 $5 ｜ 输出 $25',
  'deepseek-v4-pro': '输入 $0.28（缓存命中 $0.028）｜ 输出 $1.10（含推理 token）· 以 DeepSeek 控制台为准',
  'deepseek-v4-flash': '输入 $0.14（缓存命中 $0.0028）｜ 输出 $0.28 · 以 DeepSeek 控制台为准',
  'MiniMax-Text-01': '输入 ¥1 ｜ 输出 ¥8',
  'whisper-1': '约 $0.006 / 分钟（按音频时长计）',
}

// Retired model ids that live on in the DB (an assignment/teacher pinned them) mapped to
// their live successor. DeepSeek retires `deepseek-chat`/`deepseek-reasoner` on 2026-07-24
// (both were modes of V4 Flash), and sending those strings to the API fails after that —
// so a stored pin transparently resolves to the new id here, no data migration needed.
const LEGACY_MODEL_ALIASES: Record<string, string> = {
  'deepseek-chat': 'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-flash',
}

export function getModel(id: string): ModelDescriptor | undefined {
  const resolved = LEGACY_MODEL_ALIASES[id] ?? id
  return MODELS.find((m) => m.id === resolved)
}

export function modelsForCapability(cap: Capability): ModelDescriptor[] {
  return MODELS.filter((m) => m.capabilities.includes(cap))
}

// Pick the model that actually runs an authoring draft. The teacher's choice wins when
// it's author-capable; otherwise we fall back to the default. A textbook photo forces a
// multimodal (Gemini) model — only Gemini's author adapter reads the inline image, so a
// text-only pick (e.g. DeepSeek) would silently drop the photo. Always returns a valid id.
export function resolveAuthorModel(requestedId: string | undefined, hasImage: boolean): string {
  const requested = requestedId ? getModel(requestedId) : undefined
  const canAuthor = requested?.capabilities.includes('author') ?? false
  if (hasImage) {
    if (canAuthor && requested!.provider === 'gemini') return requested!.id
    return DEFAULT_AUTHOR_IMAGE_MODEL
  }
  if (canAuthor) return requested!.id
  return DEFAULT_AUTHOR_MODEL
}
