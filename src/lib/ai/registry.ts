import type { ModelDescriptor, Provider } from './types'

// The catalogue of models teachers can pick from. `id` is the actual API model
// name sent to the provider. Capability + modality tags drive which stage each
// model is eligible for; adapters are wired per provider in ./adapters.
export const MODELS: ModelDescriptor[] = [
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash（视频+音频，一把梭）',
    provider: 'gemini',
    capabilities: ['perception', 'judge'],
    modalities: ['video', 'audio', 'image', 'text'],
    note: '原生吃视频+音频，最省事；跑量首选。',
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro（难例复核）',
    provider: 'gemini',
    capabilities: ['perception', 'judge'],
    modalities: ['video', 'audio', 'image', 'text'],
  },
  {
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash（预览·中间价位）',
    provider: 'gemini',
    capabilities: ['perception', 'judge'],
    modalities: ['video', 'audio', 'image', 'text'],
    note: '预览版，比 3.5 Flash 便宜（约 $0.50/$3）；想升级又想控成本时用。',
  },
  {
    id: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash（最新·视频+音频·跑量首选）',
    provider: 'gemini',
    capabilities: ['perception', 'judge'],
    modalities: ['video', 'audio', 'image', 'text'],
    note: '最新稳定版 Flash，原生吃视频+音频；日常批改首选。',
  },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro（预览·难例复核）',
    provider: 'gemini',
    capabilities: ['perception', 'judge'],
    modalities: ['video', 'audio', 'image', 'text'],
    note: '预览版，能力最强；留给难例复核。',
  },
  {
    id: 'qwen-omni-turbo',
    label: '通义千问 Qwen-Omni（音频/视频+文本）',
    provider: 'qwen',
    capabilities: ['perception', 'judge'],
    modalities: ['video', 'audio', 'image', 'text'],
    note: '国内账号好申请。',
  },
  {
    id: 'MiniMax-Text-01',
    label: 'MiniMax（文本评分）',
    provider: 'minimax',
    capabilities: ['judge'],
    modalities: ['text'],
    note: '纯文本评分，配合感知模型用。',
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o（音频+抽帧）',
    provider: 'openai',
    capabilities: ['perception', 'judge'],
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
    id: 'deepseek-chat',
    label: 'DeepSeek（按评分标准打分）',
    provider: 'deepseek',
    capabilities: ['judge'],
    modalities: ['text'],
    note: '纯文本，只能做评分阶段。',
  },
  {
    id: 'claude-opus-4-8',
    label: 'Claude（精细评分+评语）',
    provider: 'claude',
    capabilities: ['judge'],
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
  { id: 'gemini35-allinone', label: 'Gemini 3.5 一把梭（默认·最新）', perceptionModel: 'gemini-3.5-flash', judgeModel: 'gemini-3.5-flash' },
  { id: 'gemini-allinone', label: 'Gemini 2.5 一把梭（更省）', perceptionModel: 'gemini-2.5-flash', judgeModel: 'gemini-2.5-flash' },
  { id: 'qwen-allinone', label: 'Qwen 一把梭', perceptionModel: 'qwen-omni-turbo', judgeModel: 'qwen-omni-turbo' },
  { id: 'qwen-minimax', label: 'Qwen 感知 + MiniMax 评分', perceptionModel: 'qwen-omni-turbo', judgeModel: 'MiniMax-Text-01' },
  { id: 'whisper-deepseek', label: 'Whisper 感知 + DeepSeek 评分', perceptionModel: 'whisper-1', judgeModel: 'deepseek-chat' },
  { id: 'gemini-claude', label: 'Gemini 感知 + Claude 评分', perceptionModel: 'gemini-2.5-flash', judgeModel: 'claude-opus-4-8' },
]

// Sensible default pairing when an assignment hasn't pinned its own models.
// Default grading model: Gemini 3.5 Flash (latest stable, natively handles
// audio/video and both perceives + judges). Teachers can still pick another model
// per assignment on the grading screen.
export const DEFAULT_PERCEPTION_MODEL = 'gemini-3.5-flash'
export const DEFAULT_JUDGE_MODEL = 'gemini-3.5-flash'
// Authoring (备课出题) keeps the cheaper 2.5 Flash by default (occasional, low-stakes
// text task); independent of the judge default so changing one never breaks the other.
export const DEFAULT_AUTHOR_MODEL = 'gemini-2.5-flash'

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
  'deepseek-chat': '输入 ¥1（缓存 ¥0.02）｜ 输出 ¥2 · 2026-07-24 停用→V4 Flash',
  'MiniMax-Text-01': '输入 ¥1 ｜ 输出 ¥8',
  'whisper-1': '约 $0.006 / 分钟（按音频时长计）',
}

export function getModel(id: string): ModelDescriptor | undefined {
  return MODELS.find((m) => m.id === id)
}

export function modelsForCapability(cap: 'perception' | 'judge'): ModelDescriptor[] {
  return MODELS.filter((m) => m.capabilities.includes(cap))
}
