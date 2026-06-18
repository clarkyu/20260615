import { describe, it, expect } from 'vitest'
import { tally, currentStreak, PTS } from '@/lib/domain/points'

const d = (s: string) => new Date(`${s}T08:00:00.000Z`)

describe('points tally', () => {
  it('sums every source and hides zero rows', () => {
    const r = tally(
      {
        feedback: { submitted: 3, adopted: 1 },
        submissions: [
          { status: 'GRADED', finalScore: 95, gradedAt: d('2026-06-10'), createdAt: d('2026-06-10') },
          { status: 'GRADED', finalScore: 80, gradedAt: d('2026-06-11'), createdAt: d('2026-06-11') },
          { status: 'GRADED', finalScore: 88, gradedAt: d('2026-06-12'), createdAt: d('2026-06-12') }, // 88 > 80 → 进步
          { status: 'DRAFT', finalScore: null, gradedAt: null, createdAt: d('2026-06-12') }, // not graded
        ],
        practice: [
          { aiScore: 70, createdAt: d('2026-06-12') },
          { aiScore: null, createdAt: d('2026-06-13') }, // unscored: day counts, no practice point
        ],
      },
      d('2026-06-13'),
    )
    // feedback: 3*10 + 1*100 = 130
    // complete: 3 graded * 20 = 60 ; highScore: one (95) * 50 = 50
    // improve: 88>80 once * 15 = 15 ; practice: 1 scored * 5 = 5
    // activeDays: {06-10,06-11,06-12,06-13} = 4 * 5 = 20
    const by = Object.fromEntries(r.rows.map((row) => [row.source, row.points]))
    expect(by.feedbackSubmit).toBe(30)
    expect(by.feedbackAdopted).toBe(100)
    expect(by.complete).toBe(60)
    expect(by.highScore).toBe(50)
    expect(by.improve).toBe(15)
    expect(by.practice).toBe(5)
    expect(by.activeDay).toBe(20)
    expect(r.total).toBe(130 + 60 + 50 + 15 + 5 + 20)
    expect(r.activeDays).toBe(4)
  })

  it('returns an empty breakdown and zero total when nothing earned', () => {
    const r = tally({ feedback: { submitted: 0, adopted: 0 }, submissions: [], practice: [] }, d('2026-06-13'))
    expect(r.total).toBe(0)
    expect(r.rows).toHaveLength(0)
    expect(r.streak).toBe(0)
  })

  it('counts improvement only on a strict increase over the previous graded score', () => {
    const r = tally(
      {
        feedback: { submitted: 0, adopted: 0 },
        submissions: [
          { status: 'GRADED', finalScore: 70, gradedAt: d('2026-06-01'), createdAt: d('2026-06-01') },
          { status: 'GRADED', finalScore: 70, gradedAt: d('2026-06-02'), createdAt: d('2026-06-02') }, // equal: no
          { status: 'GRADED', finalScore: 90, gradedAt: d('2026-06-03'), createdAt: d('2026-06-03') }, // up: yes
        ],
        practice: [],
      },
      d('2026-06-03'),
    )
    const improve = r.rows.find((row) => row.source === 'improve')
    expect(improve?.count).toBe(1)
    expect(improve?.points).toBe(PTS.improve)
  })
})

describe('currentStreak', () => {
  const days = new Set(['2026-06-11', '2026-06-12', '2026-06-13'])
  it('counts consecutive days ending today', () => {
    expect(currentStreak(days, new Date('2026-06-13T20:00:00Z'))).toBe(3)
  })
  it('still counts when the latest active day was yesterday', () => {
    expect(currentStreak(days, new Date('2026-06-14T09:00:00Z'))).toBe(3)
  })
  it('lapses to 0 once a full day is missed', () => {
    expect(currentStreak(days, new Date('2026-06-15T09:00:00Z'))).toBe(0)
  })
  it('breaks the run at the first gap', () => {
    expect(currentStreak(new Set(['2026-06-10', '2026-06-12', '2026-06-13']), new Date('2026-06-13T09:00:00Z'))).toBe(2)
  })
})
