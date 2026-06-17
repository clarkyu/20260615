// Roster import orchestration.
//
// Bulk import is a single cohesive data-orchestration unit (departments → majors →
// classes → backfill → students), with interleaved reads, id-resolution and batched
// transactions — so it owns its prisma access directly rather than fragmenting into
// a dozen single-use repo calls. The win over the old code is that it's out of the
// action: a named, school-scoped function returning plain counts.

import type { PrismaClient } from '@prisma/client'
import { hashPassword, BULK_HASH_ITERATIONS } from '@/lib/password'
import type { ParsedRoster } from '@/lib/roster'

export interface ImportResult {
  created: number
  updated: number
  skipped: number
  classesTouched: number
}

// Upsert classes + students (and their departments/majors) scoped to one school.
// New students get initial password = 学号 and must change it on first login.
export async function importRoster(prisma: PrismaClient, schoolId: number, parsed: ParsedRoster): Promise<ImportResult> {
  const valid = parsed.rows.filter((r) => !r.error)
  const skipped = parsed.rows.length - valid.length

  // 1) Departments (院系) — create the missing ones.
  const deptNames = [...new Set(valid.map((r) => r.department).filter((v): v is string => Boolean(v)))]
  const existingDepts = await prisma.department.findMany({ where: { schoolId, name: { in: deptNames } } })
  const deptIdByName = new Map(existingDepts.map((d) => [d.name, d.id]))
  for (const name of deptNames) {
    if (deptIdByName.has(name)) continue
    const d = await prisma.department.create({ data: { schoolId, name } })
    deptIdByName.set(name, d.id)
  }

  // 2) Majors (专业) — each belongs to a department.
  const majorNames = [...new Set(valid.map((r) => r.major).filter((v): v is string => Boolean(v)))]
  const existingMajors = await prisma.major.findMany({ where: { schoolId, name: { in: majorNames } } })
  const majorIdByName = new Map(existingMajors.map((m) => [m.name, m.id]))
  for (const name of majorNames) {
    if (majorIdByName.has(name)) continue
    const rep = valid.find((r) => r.major === name && r.department)
    const departmentId = rep?.department ? deptIdByName.get(rep.department) : undefined
    if (!departmentId) continue // a major with no department — skip linking
    const m = await prisma.major.create({ data: { schoolId, departmentId, name } })
    majorIdByName.set(name, m.id)
  }

  // 3) Classes — link to a major; create the missing ones.
  const classNames = [...new Set(valid.map((r) => r.className))]
  const existingClasses = await prisma.classGroup.findMany({ where: { schoolId, name: { in: classNames } } })
  const classIdByName = new Map(existingClasses.map((c) => [c.name, c.id]))
  for (const name of classNames) {
    if (classIdByName.has(name)) continue
    const rep = valid.find((r) => r.className === name)
    const majorId = rep?.major ? majorIdByName.get(rep.major) ?? null : null
    const c = await prisma.classGroup.create({ data: { schoolId, name, majorId, grade: rep?.grade } })
    classIdByName.set(name, c.id)
  }

  // Backfill major / grade on classes missing them — only fills blanks.
  const backfills = existingClasses
    .map((c) => {
      const rep = valid.find((r) => r.className === c.name)
      const data: { majorId?: number; grade?: string } = {}
      const mId = rep?.major ? majorIdByName.get(rep.major) : undefined
      if (!c.majorId && mId) data.majorId = mId
      if (!c.grade && rep?.grade) data.grade = rep.grade
      return Object.keys(data).length ? prisma.classGroup.update({ where: { id: c.id }, data }) : null
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
  if (backfills.length > 0) await prisma.$transaction(backfills)

  // 4) Which students already exist (one query).
  const existing = await prisma.user.findMany({
    where: { schoolId, role: 'STUDENT', studentNo: { in: valid.map((r) => r.studentNo) } },
    select: { id: true, studentNo: true },
  })
  const idByNo = new Map(existing.map((e) => [e.studentNo!, e.id]))
  const toCreate = valid.filter((r) => !idByNo.has(r.studentNo))
  const toUpdate = valid.filter((r) => idByNo.has(r.studentNo))

  // Emails are globally unique — only assign ones that are free (and de-dup within
  // the file) so a clashing email never aborts the whole import.
  const wantedEmails = [...new Set(toCreate.map((r) => r.email).filter((v): v is string => Boolean(v)))]
  const takenRows = wantedEmails.length
    ? await prisma.user.findMany({ where: { email: { in: wantedEmails } }, select: { email: true } })
    : []
  const usedEmail = new Set(takenRows.map((u) => u.email))
  const emailByNo = new Map<string, string | null>()
  for (const r of toCreate) {
    if (r.email && !usedEmail.has(r.email)) { usedEmail.add(r.email); emailByNo.set(r.studentNo, r.email) }
    else emailByNo.set(r.studentNo, null)
  }

  // 5) Create new students in a single batch (lighter initial-password hash). No
  //    class here — class membership is set via StudentClass in step 7.
  let created = 0
  if (toCreate.length > 0) {
    const data = await Promise.all(
      toCreate.map(async (r) => ({
        role: 'STUDENT' as const,
        schoolId,
        studentNo: r.studentNo,
        name: r.name,
        phone: r.phone ?? null,
        email: emailByNo.get(r.studentNo) ?? null,
        passwordHash: await hashPassword(r.studentNo, BULK_HASH_ITERATIONS),
        mustChangePassword: true,
      })),
    )
    try {
      created = (await prisma.user.createMany({ data })).count
    } catch {
      // A unique collision (concurrent/retried import, or a TOCTOU race on email)
      // aborts the whole single-statement createMany on D1 — so fall back to
      // per-row inserts. Drop a colliding email but keep the student; only a
      // 学号 collision skips the row entirely.
      for (const row of data) {
        try {
          await prisma.user.create({ data: row })
          created++
        } catch {
          if (row.email) {
            try {
              await prisma.user.create({ data: { ...row, email: null } })
              created++
            } catch { /* 学号 collision — skip this row */ }
          }
        }
      }
    }
  }

  // 6) Update existing students (name / phone-if-provided) in one batch. Class is a
  //    membership now: the import only ever ADDS the named class (step 7), never
  //    moves a student out of classes they're also in.
  if (toUpdate.length > 0) {
    await prisma.$transaction(
      toUpdate.map((r) =>
        prisma.user.update({
          where: { id: idByNo.get(r.studentNo)! },
          data: { name: r.name, ...(r.phone ? { phone: r.phone } : {}) },
        }),
      ),
    )
  }

  // 7) Ensure every imported student is a member of the class named in their row.
  //    Re-read ids so the just-created students are included; add only the missing
  //    (studentId, classId) pairs (existing memberships are kept).
  const all = await prisma.user.findMany({
    where: { schoolId, role: 'STUDENT', studentNo: { in: valid.map((r) => r.studentNo) } },
    select: { id: true, studentNo: true },
  })
  const idByNoAll = new Map(all.map((e) => [e.studentNo!, e.id]))
  const wanted = valid
    .map((r) => {
      const studentId = idByNoAll.get(r.studentNo)
      const classId = classIdByName.get(r.className)
      return studentId && classId ? { studentId, classId } : null
    })
    .filter((x): x is { studentId: number; classId: number } => x !== null)
  if (wanted.length > 0) {
    const studentIds = [...new Set(wanted.map((w) => w.studentId))]
    const existingMems = await prisma.studentClass.findMany({
      where: { studentId: { in: studentIds } },
      select: { studentId: true, classId: true },
    })
    const have = new Set(existingMems.map((m) => `${m.studentId}:${m.classId}`))
    const toAdd = wanted.filter((w) => !have.has(`${w.studentId}:${w.classId}`))
    if (toAdd.length > 0) {
      try {
        await prisma.studentClass.createMany({ data: toAdd })
      } catch {
        // A concurrent import may have inserted some pairs between our read and
        // write; fall back to per-row inserts and ignore the ones that now exist.
        for (const m of toAdd) {
          try { await prisma.studentClass.create({ data: m }) } catch { /* already a member */ }
        }
      }
    }
  }

  return { created, updated: toUpdate.length, skipped, classesTouched: classNames.length }
}
