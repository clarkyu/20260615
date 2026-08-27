'use client'

import Dexie, { type EntityTable } from 'dexie'
import { create } from 'zustand'
import type { StudentAnswer } from '@/lib/schema/paper'

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
  /** 冲刷同步队列(批量 PUT;失败保留 dirty 待重试)。 */
  flush: () => Promise<void>
  applyGraded: (results: (GradedFeedback & { itemId: string })[]) => void
}

let flushTimer: ReturnType<typeof setInterval> | null = null
let backoffMs = 0

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
        await dexie.answers.update(l.key, { dirty: 1 })
      }
    }
    set({ attemptId, answers: merged, graded: {}, syncState: 'synced' })

    if (flushTimer) clearInterval(flushTimer)
    flushTimer = setInterval(() => void get().flush(), 3000)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void get().flush()
      })
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void get().flush())
    }
  },

  async setAnswer(itemId, answer) {
    const attemptId = get().attemptId
    if (!attemptId) return
    const rec: LocalAnswer = {
      key: `${attemptId}:${itemId}`,
      attemptId,
      itemId,
      answer,
      clientUpdatedAt: new Date().toISOString(),
      dirty: 1,
    }
    await dexie.answers.put(rec) // 先写本地(断网不丢)
    set((s) => ({ answers: { ...s.answers, [itemId]: answer }, syncState: 'pending' }))
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
    if (backoffMs > 0) {
      backoffMs -= 3000
      if (backoffMs > 0) return
    }
    try {
      const res = await fetch(`/api/attempts/${attemptId}/responses`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          responses: dirtyRows.slice(0, 100).map((r) => ({ itemId: r.itemId, answer: r.answer, clientUpdatedAt: r.clientUpdatedAt })),
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      for (const r of dirtyRows.slice(0, 100)) await dexie.answers.update(r.key, { dirty: 0 })
      backoffMs = 0
      const remain = await dexie.answers.where('dirty').equals(1).and((x) => x.attemptId === attemptId).count()
      set({ syncState: remain > 0 ? 'pending' : 'synced' })
    } catch {
      backoffMs = backoffMs > 0 ? Math.min(backoffMs * 2, 60_000) : 6_000 // 指数退避
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

/** 交卷/提交本组前调用:冲刷并等待队列清空(SPEC §7.6)。 */
export async function flushNow(): Promise<void> {
  await useAttemptStore.getState().flush()
}
