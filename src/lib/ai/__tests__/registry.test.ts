import { describe, it, expect } from 'vitest'
import {
  DEFAULT_AUTHOR_MODEL,
  DEFAULT_AUTHOR_IMAGE_MODEL,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_PERCEPTION_MODEL,
  getModel,
  modelsForCapability,
  resolveAuthorModel,
} from '../registry'

describe('getModel + legacy aliases', () => {
  it('resolves the live DeepSeek V4 Flash id', () => {
    const m = getModel('deepseek-v4-flash')
    expect(m).toBeDefined()
    expect(m?.provider).toBe('deepseek')
    expect(m?.capabilities).toContain('judge')
  })

  it('maps retired deepseek ids to their live successor (DB pins keep working post-deprecation)', () => {
    // deepseek-chat / deepseek-reasoner retire 2026-07-24; a stored pin must still grade.
    expect(getModel('deepseek-chat')?.id).toBe('deepseek-v4-flash')
    expect(getModel('deepseek-reasoner')?.id).toBe('deepseek-v4-flash')
  })

  it('returns undefined for a genuinely unknown id', () => {
    expect(getModel('nope-9000')).toBeUndefined()
  })

  it('no longer lists the retired id as a selectable judge model', () => {
    const judgeIds = modelsForCapability('judge').map((m) => m.id)
    expect(judgeIds).toContain('deepseek-v4-flash')
    expect(judgeIds).not.toContain('deepseek-chat')
  })

  it('DeepSeek V4 Pro is the reasoning judge model', () => {
    const m = getModel('deepseek-v4-pro')
    expect(m).toMatchObject({ provider: 'deepseek', reasoning: true })
    expect(m?.capabilities).toContain('judge')
    expect(modelsForCapability('judge').map((x) => x.id)).toContain('deepseek-v4-pro')
  })
})

describe('system default models are valid + capability-correct', () => {
  it('default judge = DeepSeek V4 Pro and can actually judge', () => {
    expect(DEFAULT_JUDGE_MODEL).toBe('deepseek-v4-pro')
    expect(getModel(DEFAULT_JUDGE_MODEL)?.capabilities).toContain('judge')
  })
  it('default perception model exists and can actually perceive (DeepSeek is text-only, so it stays a multimodal model)', () => {
    const p = getModel(DEFAULT_PERCEPTION_MODEL)
    expect(p?.capabilities).toContain('perception')
    expect(p?.modalities).toContain('video')
  })
  it('gpt-4o is a judge/author only, NOT a perception model — OpenAI chat 400s on the video path (audit A9)', () => {
    const m = getModel('gpt-4o')
    expect(m?.capabilities).toEqual(expect.arrayContaining(['judge', 'author']))
    expect(m?.capabilities).not.toContain('perception')
    expect(modelsForCapability('perception').map((x) => x.id)).not.toContain('gpt-4o')
  })
})

describe('authoring capability + defaults', () => {
  it('offers DeepSeek and Gemini as authoring models, but not Whisper', () => {
    const authorIds = modelsForCapability('author').map((m) => m.id)
    expect(authorIds).toContain('deepseek-v4-flash')
    expect(authorIds).toContain('gemini-2.5-flash')
    expect(authorIds).not.toContain('whisper-1')
  })

  it('defaults text authoring to DeepSeek and the photo path to a multimodal Gemini', () => {
    expect(DEFAULT_AUTHOR_MODEL).toBe('deepseek-v4-flash')
    expect(getModel(DEFAULT_AUTHOR_MODEL)?.capabilities).toContain('author')
    const imageModel = getModel(DEFAULT_AUTHOR_IMAGE_MODEL)
    expect(imageModel?.provider).toBe('gemini')
    expect(imageModel?.modalities).toContain('image')
  })
})

describe('resolveAuthorModel', () => {
  it('falls back to the DeepSeek default when no model is requested (text path)', () => {
    expect(resolveAuthorModel(undefined, false)).toBe('deepseek-v4-flash')
  })

  it('honors an author-capable pick on the text path', () => {
    expect(resolveAuthorModel('claude-opus-4-8', false)).toBe('claude-opus-4-8')
  })

  it('ignores a non-author model and uses the default', () => {
    // whisper can't author → default
    expect(resolveAuthorModel('whisper-1', false)).toBe('deepseek-v4-flash')
  })

  it('forces the photo path onto Gemini when a text-only model was picked', () => {
    expect(resolveAuthorModel('deepseek-v4-flash', true)).toBe('gemini-2.5-flash')
  })

  it('keeps a Gemini pick on the photo path (it can read the image)', () => {
    expect(resolveAuthorModel('gemini-3.5-flash', true)).toBe('gemini-3.5-flash')
  })

  it('resolves a legacy alias before checking capability', () => {
    // deepseek-chat → deepseek-v4-flash (author-capable) on the text path
    expect(resolveAuthorModel('deepseek-chat', false)).toBe('deepseek-v4-flash')
  })
})
