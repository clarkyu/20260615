'use client'

import Dexie, { type EntityTable } from 'dexie'
import { create } from 'zustand'
import type { StudentAnswer } from '@/lib/schema/paper'
import { createTimerState, snapshot, stop, touch, type TimerState } from './item-timer'

// 离线优先的作答存储(CLAUDE.md 硬约束 7 / SPEC §7.6):
// 每次作答变更 **先写 IndexedDB** 再进同步队列;队列每 3 秒、输入失焦、页面隐藏、
// 切换题组时批量 PUT;离线时指数退避重试;重开页面先本地恢复再与服务端按
// clientUpdatedAt 合并。顶栏用 syncState 显示 已同步/待同步/离线 小圆点。

export interface LocalAnswer {
  key: string // `${attemptId}:${itemId}`
  attemptId: string
  itemId: string
  answer: StudentAnswer
  clientUpdatedAt: string // ISO
  dirty: number // 1 = 待同步(Dexie 索引用数字)
  /**
   * 1 = 这条之所以待同步,只是因为用时埋点变了,作答本身早传上去了。
   * 交卷前只看「作答」有没有传完:埋点永远不能挡着学生交卷(同下方 persistTime 的原则)。
   */
  timeOnly?: number
  /** 这一题的累计用时(毫秒),埋点尽力而为(见 item-timer.ts) */
  timeSpentMs?: number
}

const dexie = new Dexie('zsb-qbank') as Dexie & { answers: EntityTable<LocalAnswer, 'key'> }
dexie.version(1).stores({ answers: 'key, attemptId, dirty' })

export type SyncState = 'synced' | 'pending' | 'offline'

/** 判分反馈(check 接口返回,经编排页归一化后入 store)。 */
export interface GradedFeedback {
  verdict: string
  score: number
  fullScore: number
  accepted: string[]
  explanation: string | null
  /** AI 判分的中文评语(主观题) */
  feedback?: string | null
  /** 常见错答(§5.4,客观题答错时) */
  commonMistakes?: string[]
}

interface AttemptState {
  attemptId: string | null
  answers: Record<string, StudentAnswer> // itemId → answer
  graded: Record<string, GradedFeedback>
  syncState: SyncState
  /** 初始化:本地恢复 + 服务端合并(按 clientUpdatedAt 新者胜)。 */
  init: (attemptId: string, server: { itemId: string; answer: unknown; clientUpdatedAt: string }[]) => Promise<void>
  /** 写作答:先落 IndexedDB,标 dirty,更新内存。 */
  setAnswer: (itemId: string, answer: StudentAnswer) => Promise<void>
  /** 标记「正在做这道题」:逐题计时用(SPEC §8 中位用时)。埋点失败不影响作答。 */
  touchItem: (itemId: string) => void
  /** 冲刷同步队列(批量 PUT;失败保留 dirty 待重试)。 */
  flush: () => Promise<void>
  applyGraded: (results: (GradedFeedback & { itemId: string })[]) => void
}

let flushTimer: ReturnType<typeof setInterval> | null = null
let backoffMs = 0
/** 退避到期时间戳:在此之前不重试。用时间戳而不是「每次 flush 减 3000」——
 *  后者会被 visibilitychange / online / flushNow 这些额外调用提前耗掉,退避形同虚设。 */
let retryAfter = 0
let offListeners: (() => void) | null = null
// 逐题计时(SPEC §8):只在内存 + 随作答一起落 IndexedDB;埋点出任何问题都不能影响作答。
let timer: TimerState = createTimerState()

/** 把计时结果写回本地记录(有作答的才写:没作答的题不需要用时)。 */
async function persistTime(attemptId: string, itemId: string): Promise<void> {
  try {
    const ms = timer.totals[itemId]
    if (!ms) return
    const key = `${attemptId}:${itemId}`
    const row = await dexie.answers.get(key)
    if (!row) return
    if ((row.timeSpentMs ?? 0) >= ms) return
    // 作答本身已经同步过了(dirty=0),这次只是补埋点 → 标成 timeOnly,不让它挡交卷。
    await dexie.answers.update(key, { timeSpentMs: ms, dirty: 1, timeOnly: row.dirty === 1 ? (row.timeOnly ?? 0) : 1 })
  } catch {
    // 埋点失败就算了(硬约束 7:作答不能因此受影响)
  }
}

export const useAttemptStore = create<AttemptState>((set, get) => ({
  attemptId: null,
  answers: {},
  graded: {},
  syncState: 'synced',

  async init(attemptId, server) {
    const local = await dexie.answers.where('attemptId').equals(attemptId).toArray()
    const merged: Record<string, StudentAnswer> = {}
    const localByItem = new Map(local.map((l) => [l.itemId, l]))
    // 服务端底稿
    for (const r of server) {
      merged[r.itemId] = r.answer as StudentAnswer
    }
    // 本地覆盖(更新时间新者胜);同时把「本地更新」补回同步队列。
    const serverAt = new Map(server.map((r) => [r.itemId, Date.parse(r.clientUpdatedAt)]))
    for (const l of localByItem.values()) {
      const sAt = serverAt.get(l.itemId) ?? 0
      if (Date.parse(l.clientUpdatedAt) > sAt) {
        merged[l.itemId] = l.answer
        await dexie.answers.update(l.key, { dirty: 1, timeOnly: 0 }) // 本地这份作答比服务端新,得传上去
      }
    }
    timer = createTimerState(Object.fromEntries(local.filter((l) => l.timeSpentMs).map((l) => [l.itemId, l.timeSpentMs!])))
    backoffMs = 0 // 上一份作答的失败退避不能带到这一份
    retryAfter = 0
    // 断网时刷新页面,本地往往还压着没传上去的作答:这时候顶栏不能显示「已保存」骗人。
    const pending = await pendingCount(attemptId)
    set({
      attemptId,
      answers: merged,
      graded: {},
      syncState: pending === 0 ? 'synced' : typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'pending',
    })

    if (flushTimer) clearInterval(flushTimer)
    flushTimer = setInterval(() => void get().flush(), 3000)
    // 重开一份作答要先摘掉上一份的监听,否则每开一次就多一份,同一个事件冲好几遍队列。
    offListeners?.()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // 切后台:结束当前这段计时(人不在看题了),再冲队列。
        const flushed = stop(timer, Date.now())
        if (flushed) void persistTime(attemptId, flushed)
        void get().flush()
      }
    }
    const onOnline = () => {
      // 网络刚回来:立刻重试,而不是干等最长 60 秒的退避走完。
      backoffMs = 0
      retryAfter = 0
      void get().flush()
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline)
    offListeners = () => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline)
      offListeners = null
    }
  },

  async setAnswer(itemId, answer) {
    const attemptId = get().attemptId
    if (!attemptId) return
    const now = Date.now()
    const flushed = touch(timer, itemId, now) // 正在改这道题 = 正在做这道题
    const rec: LocalAnswer = {
      key: `${attemptId}:${itemId}`,
      attemptId,
      itemId,
      answer,
      clientUpdatedAt: new Date(now).toISOString(),
      dirty: 1,
      timeOnly: 0, // 作答变了,这条是实打实要传的
      timeSpentMs: snapshot(timer, now)[itemId],
    }
    await dexie.answers.put(rec) // 先写本地(断网不丢)
    if (flushed && flushed !== itemId) void persistTime(attemptId, flushed)
    set((s) => ({ answers: { ...s.answers, [itemId]: answer }, syncState: 'pending' }))
  },

  touchItem(itemId) {
    const attemptId = get().attemptId
    if (!attemptId) return
    try {
      const flushed = touch(timer, itemId, Date.now())
      if (flushed) void persistTime(attemptId, flushed)
    } catch {
      // 同上:计时坏了也不能影响作答
    }
  },

  async flush() {
    const attemptId = get().attemptId
    if (!attemptId) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      set({ syncState: 'offline' })
      return
    }
    const dirtyRows = await dexie.answers.where('dirty').equals(1).and((r) => r.attemptId === attemptId).toArray()
    if (dirtyRows.length === 0) {
      set({ syncState: 'synced' })
      return
    }
    if (Date.now() < retryAfter) return
    try {
      const res = await fetch(`/api/attempts/${attemptId}/responses`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          responses: dirtyRows.slice(0, 100).map((r) => ({ itemId: r.itemId, answer: r.answer, clientUpdatedAt: r.clientUpdatedAt, ...(r.timeSpentMs ? { timeSpentMs: r.timeSpentMs } : {}) })),
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      for (const r of dirtyRows.slice(0, 100)) await dexie.answers.update(r.key, { dirty: 0, timeOnly: 0 })
      backoffMs = 0
      retryAfter = 0
      const remain = await dexie.answers.where('dirty').equals(1).and((x) => x.attemptId === attemptId).count()
      set({ syncState: remain > 0 ? 'pending' : 'synced' })
    } catch {
      backoffMs = backoffMs > 0 ? Math.min(backoffMs * 2, 60_000) : 6_000 // 指数退避
      retryAfter = Date.now() + backoffMs
      set({ syncState: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'pending' })
    }
  },

  applyGraded(results) {
    set((s) => {
      const graded = { ...s.graded }
      for (const r of results) {
        const { itemId, ...rest } = r
        graded[itemId] = rest
      }
      return { graded }
    })
  },
}))

/** 还有多少题的**作答**没同步上去(只差用时埋点的不算,埋点不挡交卷)。 */
export async function pendingCount(attemptId: string): Promise<number> {
  try {
    return await dexie.answers
      .where('dirty')
      .equals(1)
      .and((r) => r.attemptId === attemptId && r.timeOnly !== 1)
      .count()
  } catch {
    return 0 // 本地库都读不了就别再拦着学生交卷了
  }
}

/**
 * 交卷 / 对答案前调用:结束计时、冲刷并**等到作答全部送达服务端**(SPEC §7.6)。
 * 返回是否送达了 —— 调用方必须看这个返回值:交卷之后保存接口对已交的 attempt 一律返回
 * 409「已交卷,不能再保存」,此刻还卡在本地的作答就再也传不上去,等于学生白做(硬约束 7)。
 */
export async function flushNow(): Promise<boolean> {
  const attemptId = useAttemptStore.getState().attemptId
  const flushed = stop(timer, Date.now())
  if (attemptId && flushed) await persistTime(attemptId, flushed)
  if (!attemptId) return true

  // 人主动点的:这一次必须真的发出去,不能被后台重试的退避挡住。
  // 先无条件冲一次 —— 顺畅的时候作答和最后一段用时都在这一次送出去了。
  backoffMs = 0
  retryAfter = 0
  await useAttemptStore.getState().flush()

  // flush() 一轮最多发 100 条;循环到作答全部送达为止,一轮下来没进展就认输,不空转。
  let before = await pendingCount(attemptId)
  while (before > 0) {
    backoffMs = 0
    retryAfter = 0
    await useAttemptStore.getState().flush()
    const after = await pendingCount(attemptId)
    if (after === 0) return true
    if (after >= before) return false
    before = after
  }
  return true
}
