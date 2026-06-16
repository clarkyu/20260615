import { describe, it, expect, vi } from 'vitest'
import { createOfferings, updateOffering, type OfferingInput } from '../offerings'

const input: OfferingInput = { courseName: 'English', courseCode: 'eng1', year: '2025-2026', semester: '1' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fake(opts: { validClassIds?: number[]; existingClassIds?: number[]; offering?: any; classForSchool?: any } = {}): any {
  const createMany = vi.fn(async () => ({ count: 1 }))
  const update = vi.fn(async () => ({}))
  return {
    _createMany: createMany,
    _update: update,
    classGroup: {
      findMany: async () => (opts.validClassIds ?? []).map((id) => ({ id })),
      findFirst: async () => opts.classForSchool ?? null,
    },
    course: { upsert: async () => ({ id: 100, name: input.courseName, code: 'ENG1' }) },
    courseOffering: {
      findMany: async () => (opts.existingClassIds ?? []).map((classId) => ({ classId })),
      createMany,
      // findOne (select id) vs findForSchoolWithCourse (include course) — disambiguate.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: async (args: any) => (args?.include?.course ? (opts.offering ?? null) : { id: 500 }),
      update,
    },
  }
}

describe('createOfferings', () => {
  it('errors when no class is selected', async () => {
    expect(await createOfferings(fake(), 1, 9, input, [])).toEqual({ ok: false, error: 'err.needClass' })
  })

  it('errors when no selected class belongs to the school', async () => {
    expect(await createOfferings(fake({ validClassIds: [] }), 1, 9, input, [5, 6])).toEqual({ ok: false, error: 'err.classNotFound' })
  })

  it('single class → redirects straight to that offering', async () => {
    const db = fake({ validClassIds: [5], existingClassIds: [] })
    expect(await createOfferings(db, 1, 9, input, [5])).toEqual({ ok: true, redirectTo: '/dashboard/teaching/500' })
    expect(db._createMany).toHaveBeenCalled()
  })

  it('several classes → redirects to the list', async () => {
    const db = fake({ validClassIds: [5, 6], existingClassIds: [] })
    expect(await createOfferings(db, 1, 9, input, [5, 6])).toEqual({ ok: true, redirectTo: '/dashboard/teaching' })
  })

  it('skips classes that already have this exact offering', async () => {
    const db = fake({ validClassIds: [5, 6], existingClassIds: [5, 6] })
    await createOfferings(db, 1, 9, input, [5, 6])
    expect(db._createMany).not.toHaveBeenCalled()
  })
})

describe('updateOffering', () => {
  it('errors when the offering is not in the school', async () => {
    expect(await updateOffering(fake({ offering: null }), 1, 7, input, 5)).toEqual({ ok: false, error: 'err.offeringNotFound' })
  })

  it('errors when the target class is not in the school', async () => {
    expect(await updateOffering(fake({ offering: { id: 7, course: {} }, classForSchool: null }), 1, 7, input, 5)).toEqual({ ok: false, error: 'err.classNotFound' })
  })

  it('updates on the happy path', async () => {
    const db = fake({ offering: { id: 7, course: {} }, classForSchool: { id: 5 } })
    expect(await updateOffering(db, 1, 7, input, 5)).toEqual({ ok: true })
    expect(db._update).toHaveBeenCalled()
  })
})
