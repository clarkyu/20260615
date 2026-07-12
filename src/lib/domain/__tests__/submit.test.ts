import { describe, it, expect } from 'vitest'
import { resolveAttempt, missingRequiredPart, isPollOnly, requiredMediaUnhealthy, corruptRequiredMedia, unhealthyShadowTakes } from '../submit'

// ── missingRequiredPart (pure) ───────────────────────────────────────────────

const reqs = { requireText: false, requireVideo: false, requireAudio: false, requireHandwriting: false, requireChoice: false, requireFreeText: false, fillBlank: false }
const parts = { recitedText: null as string | null, videoKey: null as string | null, audioKey: null as string | null, imageKey: null as string | null }

describe('missingRequiredPart', () => {
  it('returns the first missing required part as an i18n key', () => {
    expect(missingRequiredPart({ ...reqs, requireText: true }, parts)).toBe('err.needRecite')
    expect(missingRequiredPart({ ...reqs, requireVideo: true }, parts)).toBe('err.noVideoYet')
    expect(missingRequiredPart({ ...reqs, requireAudio: true }, parts)).toBe('err.noAudioYet')
    expect(missingRequiredPart({ ...reqs, requireHandwriting: true }, parts)).toBe('err.noImageYet')
    // 单选投票 / 自由文本：答案都落在 recitedText 上。
    expect(missingRequiredPart({ ...reqs, requireChoice: true }, parts)).toBe('err.needChoice')
    expect(missingRequiredPart({ ...reqs, requireFreeText: true }, parts)).toBe('err.needFreeText')
    expect(missingRequiredPart({ ...reqs, requireChoice: true }, { ...parts, recitedText: 'B' })).toBeNull()
    expect(missingRequiredPart({ ...reqs, requireFreeText: true }, { ...parts, recitedText: 'hello' })).toBeNull()
  })

  it('checks text first when several parts are required', () => {
    expect(missingRequiredPart({ ...reqs, requireText: true, requireVideo: true }, parts)).toBe('err.needRecite')
  })

  it('returns null when every required part is present', () => {
    const all = { recitedText: 'hi', videoKey: 'v', audioKey: 'a', imageKey: 'i' }
    expect(missingRequiredPart({ ...reqs, requireText: true, requireVideo: true, requireAudio: true, requireHandwriting: true }, all)).toBeNull()
  })

  it('ignores parts that are not required', () => {
    expect(missingRequiredPart(reqs, parts)).toBeNull()
  })
})

describe('isPollOnly', () => {
  it('is true only for a pure single-choice poll', () => {
    expect(isPollOnly({ ...reqs, requireChoice: true })).toBe(true)
  })
  it('is false when the poll is mixed with anything that needs a look', () => {
    expect(isPollOnly({ ...reqs, requireChoice: true, requireFreeText: true })).toBe(false)
    expect(isPollOnly({ ...reqs, requireChoice: true, requireVideo: true })).toBe(false)
    expect(isPollOnly({ ...reqs, requireChoice: true, requireText: true })).toBe(false)
  })
  it('is false when there is no choice at all', () => {
    expect(isPollOnly(reqs)).toBe(false)
    expect(isPollOnly({ ...reqs, requireFreeText: true })).toBe(false)
  })
})

// ── resolveAttempt (gating logic, fake prisma) ───────────────────────────────
// A submission is per-phase now: resolveAttempt gates on the PHASE's window +
// attempt cap (repo reads prisma.phase.findFirst), and returns the owning
// assignment id + the phase's submit requirements.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakePrisma(phase: any, usedCount = 0): any {
  return {
    phase: { findFirst: async () => phase },
    submission: { count: async () => usedCount },
  }
}
const REQS = { requireText: false, requireVideo: true, requireAudio: false, requireHandwriting: false, requireChoice: false, requireFreeText: false }
const A = (over: Record<string, unknown> = {}) => ({ id: 5, assignmentId: 9, assignment: { offeringId: 12 }, maxAttempts: 3, openAt: null, dueAt: null, ...REQS, ...over })

describe('resolveAttempt', () => {
  it('rejects a student with no class', async () => {
    expect(await resolveAttempt(fakePrisma(A()), 7, [], 1)).toEqual({ ok: false, error: 'err.noClassAssigned' })
  })

  it('rejects when the assignment is not in the class', async () => {
    expect(await resolveAttempt(fakePrisma(null), 7, [2], 1)).toEqual({ ok: false, error: 'err.assignNotFound' })
  })

  it('rejects before open and after due', async () => {
    const future = new Date(Date.now() + 60_000)
    const past = new Date(Date.now() - 60_000)
    expect(await resolveAttempt(fakePrisma(A({ openAt: future })), 7, [2], 1)).toEqual({ ok: false, error: 'err.notOpen' })
    expect(await resolveAttempt(fakePrisma(A({ dueAt: past })), 7, [2], 1)).toEqual({ ok: false, error: 'err.closed' })
  })

  it('rejects when all attempts are used', async () => {
    expect(await resolveAttempt(fakePrisma(A({ maxAttempts: 2 }), 2), 7, [2], 5)).toEqual({ ok: false, error: 'err.attemptsUsed' })
  })

  it('returns the next attempt number + assignment id + phase requirements on the happy path', async () => {
    expect(await resolveAttempt(fakePrisma(A({ maxAttempts: 3 }), 1), 7, [2], 5)).toEqual({
      ok: true,
      attempt: 2,
      assignmentId: 9,
      offeringId: 12,
      phaseId: 5,
      requirements: REQS,
    })
  })
})

// ── 甲·分流提交门(硬完整性:防绕过前端 POST 到别人分支) ────────────────────────────
// gated 环节(branchTopicsJson 非空)只放行「选题·分流环节选中对应题目」的学生。
describe('resolveAttempt — 甲·分流提交门', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fakeBranchPrisma = (opts: { gatedPhase: any; selPhaseId: number | null; chosenTopic: string | null; used?: number }): any => ({
    phase: {
      // findChosenTopic 查的是 selectionMode='branch' 的选题环节;resolveAttempt 查的是本环节。
      findFirst: async (args: { where?: { selectionMode?: string } }) =>
        args?.where?.selectionMode === 'branch' ? (opts.selPhaseId ? { id: opts.selPhaseId } : null) : opts.gatedPhase,
    },
    submission: {
      count: async () => opts.used ?? 0,
      findFirst: async () => (opts.chosenTopic !== null ? { recitedText: opts.chosenTopic } : null),
    },
  })
  const gated = (topics: string) => A({ maxAttempts: 3, branchTopicsJson: topics })

  it('选了对应题目 → 放行', async () => {
    const r = await resolveAttempt(fakeBranchPrisma({ gatedPhase: gated('["自我介绍"]'), selPhaseId: 1, chosenTopic: '自我介绍', used: 0 }), 7, [2], 5)
    expect(r.ok).toBe(true)
  })
  it('选了别的题目 → 拒绝', async () => {
    const r = await resolveAttempt(fakeBranchPrisma({ gatedPhase: gated('["自我介绍"]'), selPhaseId: 1, chosenTopic: '课文背诵', used: 0 }), 7, [2], 5)
    expect(r).toEqual({ ok: false, error: 'err.phaseNotYours' })
  })
  it('还没选题 → 拒绝', async () => {
    const r = await resolveAttempt(fakeBranchPrisma({ gatedPhase: gated('["自我介绍"]'), selPhaseId: 1, chosenTopic: null, used: 0 }), 7, [2], 5)
    expect(r).toEqual({ ok: false, error: 'err.phaseNotYours' })
  })
  it('公共环节(无归属题目)→ 放行,不查选题(零开销)', async () => {
    // fakePrisma 里没有 submission.findFirst：若门去查它就会抛,证明公共环节根本没走查询。
    const r = await resolveAttempt(fakePrisma(A({ maxAttempts: 3 }), 0), 7, [2], 5)
    expect(r.ok).toBe(true)
  })
})

describe('requiredMediaUnhealthy — 提交完整性门(期末考核复盘)', () => {
  const probe = (table: Record<string, 'ok' | 'empty' | 'missing' | 'unknown'>) => async (key: string) => table[key] ?? 'missing'

  it('要求的媒体对象缺失或为空 → 拦下', async () => {
    expect(await requiredMediaUnhealthy({ requireVideo: true, requireAudio: false }, { videoKey: 'k/v', audioKey: null }, probe({ 'k/v': 'missing' }))).toBe(true)
    expect(await requiredMediaUnhealthy({ requireVideo: true, requireAudio: false }, { videoKey: 'k/v', audioKey: null }, probe({ 'k/v': 'empty' }))).toBe(true)
    expect(await requiredMediaUnhealthy({ requireVideo: false, requireAudio: true }, { videoKey: null, audioKey: 'k/a' }, probe({ 'k/a': 'missing' }))).toBe(true)
  })

  it('对象健康 → 放行;unknown(网络抖动)也放行,不卡全班提交', async () => {
    expect(await requiredMediaUnhealthy({ requireVideo: true, requireAudio: false }, { videoKey: 'k/v', audioKey: null }, probe({ 'k/v': 'ok' }))).toBe(false)
    expect(await requiredMediaUnhealthy({ requireVideo: true, requireAudio: false }, { videoKey: 'k/v', audioKey: null }, probe({ 'k/v': 'unknown' }))).toBe(false)
  })

  it('不要求的媒体不探测;要求但连键都没有的走 missingRequiredPart 既有提示(此处放行)', async () => {
    // requireVideo=false:即便 videoKey 指向缺失对象也不探测(比如文本环节的历史遗留键)。
    expect(await requiredMediaUnhealthy({ requireVideo: false, requireAudio: false }, { videoKey: 'k/gone', audioKey: null }, probe({}))).toBe(false)
    expect(await requiredMediaUnhealthy({ requireVideo: true, requireAudio: false }, { videoKey: null, audioKey: null }, probe({}))).toBe(false)
  })
})

describe('unhealthyShadowTakes — 逐句提交完整性门(shadow 音频在 ShadowTake 里)', () => {
  const probe = (table: Record<string, 'ok' | 'empty' | 'missing' | 'unknown'>) => async (key: string) => table[key] ?? 'ok'
  const takes = [
    { order: 1, audioKey: 'k1' },
    { order: 2, audioKey: 'k2' },
    { order: 3, audioKey: 'k3' },
  ]

  it('全部健康 → 空数组(放行)', async () => {
    expect(await unhealthyShadowTakes(takes, probe({ k1: 'ok', k2: 'ok', k3: 'ok' }))).toEqual([])
  })

  it('返回空/缺的句子 order(升序),unknown 放行不计', async () => {
    // 第 2 句 0 字节(416→empty)、第 3 句缺失(404→missing)、第 1 句网络抖(unknown 放行)。
    expect(await unhealthyShadowTakes(takes, probe({ k1: 'unknown', k2: 'empty', k3: 'missing' }))).toEqual([2, 3])
  })

  it('并发分批仍覆盖所有 take,结果按 order 升序(concurrency 小于总数)', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ order: i + 1, audioKey: `m${i + 1}` }))
    const bad = await unhealthyShadowTakes(many, probe({ m3: 'empty', m9: 'missing' }), 4)
    expect(bad).toEqual([3, 9])
  })

  it('空 take 列表 → 空数组', async () => {
    expect(await unhealthyShadowTakes([], probe({}))).toEqual([])
  })
})

describe('resilientProbe(瞬时 404 复测)', () => {
  it('首判 ok/unknown 直接透传,不复测', async () => {
    const { resilientProbe } = await import('../submit')
    let calls = 0
    const probe = async () => { calls++; return 'ok' as const }
    expect(await resilientProbe(probe, 'k', 1)).toBe('ok')
    expect(calls).toBe(1)
  })

  it('首判 missing 复测一次:第二次 ok 则放行,第二次仍坏才定罪', async () => {
    const { resilientProbe } = await import('../submit')
    const flaky = (results: ('ok' | 'missing' | 'empty' | 'unknown')[]) => {
      let i = 0
      return async () => results[i++]
    }
    expect(await resilientProbe(flaky(['missing', 'ok']), 'k', 1)).toBe('ok')
    expect(await resilientProbe(flaky(['missing', 'missing']), 'k', 1)).toBe('missing')
    expect(await resilientProbe(flaky(['empty', 'empty']), 'k', 1)).toBe('empty')
  })
})

describe('corruptRequiredMedia(坏媒体即时拒收)', () => {
  const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42])
  const ZEROS = new Uint8Array(16) // 全零:上传坏死的典型签名
  const heads = (map: Record<string, Uint8Array | null>) => async (key: string) => map[key] ?? null

  it('要求的媒体头部命中已知容器 → 放行', async () => {
    const ok = await corruptRequiredMedia(
      { requireVideo: true, requireAudio: false },
      { videoKey: 'v1', audioKey: null },
      heads({ v1: WEBM }),
    )
    expect(ok).toBe(false)
  })

  it('要求的媒体头部是全零/垃圾 → 拒收', async () => {
    const bad = await corruptRequiredMedia(
      { requireVideo: true, requireAudio: false },
      { videoKey: 'v1', audioKey: null },
      heads({ v1: ZEROS }),
    )
    expect(bad).toBe(true)
  })

  it('读不到头(null,网络抖/404)→ 放行,绝不因抖动拒收', async () => {
    const ok = await corruptRequiredMedia(
      { requireVideo: true, requireAudio: true },
      { videoKey: 'v1', audioKey: 'a1' },
      heads({ v1: null, a1: null }),
    )
    expect(ok).toBe(false)
  })

  it('非要求/无键的媒体不探测;音频坏同样拦', async () => {
    const bad = await corruptRequiredMedia(
      { requireVideo: false, requireAudio: true },
      { videoKey: 'v-ignored', audioKey: 'a1' },
      heads({ 'v-ignored': ZEROS, a1: ZEROS }),
    )
    expect(bad).toBe(true)
    const ok = await corruptRequiredMedia(
      { requireVideo: false, requireAudio: false },
      { videoKey: null, audioKey: null },
      heads({}),
    )
    expect(ok).toBe(false)
  })
})
