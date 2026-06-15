import type { ModelDescriptor } from './types'

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
  { id: 'gemini-allinone', label: 'Gemini 一把梭', perceptionModel: 'gemini-2.5-flash', judgeModel: 'gemini-2.5-flash' },
  { id: 'qwen-allinone', label: 'Qwen 一把梭', perceptionModel: 'qwen-omni-turbo', judgeModel: 'qwen-omni-turbo' },
  { id: 'qwen-minimax', label: 'Qwen 感知 + MiniMax 评分', perceptionModel: 'qwen-omni-turbo', judgeModel: 'MiniMax-Text-01' },
  { id: 'whisper-deepseek', label: 'Whisper 感知 + DeepSeek 评分', perceptionModel: 'whisper-1', judgeModel: 'deepseek-chat' },
  { id: 'gemini-claude', label: 'Gemini 感知 + Claude 评分', perceptionModel: 'gemini-2.5-flash', judgeModel: 'claude-opus-4-8' },
]

// Sensible default pairing when an assignment hasn't pinned its own models —
// Gemini Flash natively handles audio/video and can both perceive and judge.
export const DEFAULT_PERCEPTION_MODEL = 'gemini-2.5-flash'
export const DEFAULT_JUDGE_MODEL = 'gemini-2.5-flash'

export function getModel(id: string): ModelDescriptor | undefined {
  return MODELS.find((m) => m.id === id)
}

export function modelsForCapability(cap: 'perception' | 'judge'): ModelDescriptor[] {
  return MODELS.filter((m) => m.capabilities.includes(cap))
}
