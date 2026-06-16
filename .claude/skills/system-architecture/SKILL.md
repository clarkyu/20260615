---
name: system-architecture
description: Server-side layering conventions for the 你好！作业 / Hi-Homework codebase (Next.js App Router on Cloudflare Workers + D1 + R2). Use when adding or modifying ANY server-side code — server actions, business logic, data access, multi-tenant queries, env/config, or input validation. Tells you which layer code belongs in (action → domain → repo), the tenant-scoping rule, and the patterns to copy.
---

# 系统架构分层 / System Architecture

This codebase has a strict server-side layering. Put new code in the right layer
and copy the established patterns — don't reinvent or shortcut them.

```
 app/**            页面 Server Component — render + read-only aggregate queries
 actions/**        Server Action — auth → validate → delegate → revalidate/redirect (THIN)
 lib/domain/**     Domain service — business orchestration + policy (no auth/i18n/Next)
 lib/repo/**       Repository — data access + multi-tenant scoping (the ONLY normal place that calls prisma)
 lib/**            Infra — db / session / storage / ai / config / validate …
```

Dependencies flow downward only: action → domain/repo, domain → repo, repo → prisma.
The canonical reference is `docs/ARCHITECTURE.md`; this skill is the actionable version.

## Decision: where does my code go?

- **Reading/writing the DB?** → a function in `lib/repo/<aggregate>.ts`, signature
  `(prisma, …args)`. Never write a prisma query directly in an action — **this is
  lint-enforced** (`src/actions/**` may not import `@/lib/db` / `@prisma/client`, nor
  call `prisma.x` / `cx.prisma.x`; only `src/actions/auth.ts` is exempt, by design).
- **Multi-step business logic / a policy decision?** → `lib/domain/<thing>.ts`.
- **A single-step CRUD?** → the action may call the repo directly (no pointless service).
- **Rendering + a read-only stat query on a page?** → page Server Component may call
  prisma directly (intentional boundary — see below).
- **Reading an env var?** → add a getter to `lib/config.ts`; never `process.env.X` elsewhere.

## Patterns to copy

### Thin staff action
```ts
'use server'
import { staffSchoolContext } from '@/lib/action-context'
import * as fooRepo from '@/lib/repo/foo'
import { doThing } from '@/lib/domain/foo'
import { parseForm, reqText, z } from '@/lib/validate'

export async function createFoo(prevState: unknown, formData: FormData) {
  const cx = await staffSchoolContext()        // { user, prisma, t, schoolId }
  if (!cx.ok) return { error: cx.error }        // standard "create your school first"
  const parsed = parseForm(z.object({ name: reqText('err.needName', 100) }), formData)
  if (!parsed.ok) return { error: cx.t(parsed.error) }

  const res = await doThing(cx.prisma, cx.schoolId, parsed.data)  // delegate
  if (!res.ok) return { error: cx.t(res.error) }                 // i18n key → translate
  revalidatePath('/dashboard/...')             // revalidate/redirect ONLY here
  return { success: true }
}
```
Context helpers (`@/lib/action-context`): `staffContext()` → `{ user, prisma, t }`;
`staffSchoolContext()` → tagged `{ ok, …, schoolId: number }`; `studentContext()` for
`requireRole('STUDENT')`.

### Repository — tenant scoping lives here, nowhere else
```ts
// lib/repo/foo.ts
import type { PrismaClient } from '@prisma/client'

export function findForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.foo.findFirst({ where: { id, schoolId: schoolId ?? -1 } })  // ?? -1 sentinel
}
```
- Every query is scoped to the actor's `schoolId` (or via `offering.schoolId` /
  `offering.classId`). The `?? -1` sentinel guarantees a user without a school matches
  no rows. This is the security boundary — keep it in one place per aggregate.
- No auth, no i18n, no Next imports in repos.

### Domain service — returns data, not responses
```ts
// lib/domain/foo.ts
export type Result = { ok: true; redirectTo: string } | { ok: false; error: string }
export async function doThing(prisma, schoolId, input): Promise<Result> {
  if (await foo.dupName(prisma, schoolId, input.name)) return { ok: false, error: 'err.dup' }
  await foo.create(prisma, { schoolId, ...input })
  return { ok: true, redirectTo: '/dashboard/...' }
}
```
- Takes `prisma` + plain inputs; errors are i18n key strings; navigation targets are
  returned for the action to `redirect`. No `requireXxx`, `getT`, `cookies`, `redirect`.
- Reads/writes via repos. **Exception:** a cohesive bulk op (e.g. `domain/roster.ts`
  import) may call prisma directly rather than fragment into one-shot repos.

### Input validation — the only trusted boundary
- All action input goes through `parseForm(schema, formData)` from `@/lib/validate`
  (zod v4). Field messages are i18n keys. Builders: `reqText` / `optText` / `reqId` /
  `optId` / `idList` / `checkbox` / `intField`.

### Config — one source of truth
- `lib/config.ts` owns all `process.env` reads. Use `config.xxx()` getters and the
  `storageConfigured()` / `aiConfigured()` / `emailConfigured()` flags.
- `validateConfigOnce()` (called in root layout) logs a **redacted** startup report.
  **SECURITY: never log or return a secret VALUE — names + present/absent only.**

## Cloudflare / D1 constraints (don't get bitten)
- **No interactive transactions on D1.** A nested autoincrement `create` inside
  `$transaction` fails — do standalone creates (e.g. one assignment create per offering).
  `createMany` and `$transaction([deleteMany, createMany])` are fine.
- Prisma client is per-isolate, memoised on the D1 binding (`lib/db.ts`).
- Background work after the response: `runAfterResponse` (`lib/cf.ts`, Worker `waitUntil`).
- Durable grading: enqueue a `GradingJob` + `drainGradingJobs` (`lib/domain/jobs.ts`) —
  persistent + bounded-retry + self-heal; never fire-and-forget a one-shot grade.

## Intentional boundaries (leave these alone unless asked)
- **Page reads are migrating into `lib/repo`** (incremental, per page/vertical — bank done
  first). New page reads should call a repo function, not write prisma inline; the page
  still gets prisma via `getDb()` and passes it to the repo. (The lint rule is
  actions-only, so pages may import `@/lib/db` — but prefer a repo for the query.)
- **Auth flows (login/register/reset/verify) stay bespoke** — login uses constant-time
  fake verification on the not-found path to avoid a timing side-channel; do NOT convert
  it to "parse-then-early-return".

## Security invariants (always)
- Secrets come from env only; never write them to files or commit them; logs record
  presence, never values.
- Every data access is school/class scoped; the cross-tenant guard lives in `lib/repo`.
- i18n: keep `zh` and `en` dicts in `src/lib/i18n.ts` at full parity when adding keys.
