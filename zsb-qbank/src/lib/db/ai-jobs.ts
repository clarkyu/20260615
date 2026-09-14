import { and, eq, inArray, ne, or, isNull, sql } from 'drizzle-orm'
import type { Db } from './client'
import { aiGradeCache, aiJobs, attempts, groups, items, responses, wrongAnswers } from './schema'
import { itemSchema, studentAnswerSchema, type Item } from '@/lib/schema/paper'
import { AiError, type AiCaller, extractJson } from '@/lib/ai/client'
import { PROMPT_VERSION, buildExplainUser, buildGradeUser, gradePromptFor, loadPrompt, studentAnswerText } from '@/lib/ai/prompts'
import { answerHash } from '@/lib/ai/hash'
import {
  aiExplainResultSchema,
  applyWritingWordFloor,
  foldBinary,
  looksLikeInjection,
  postprocessAiGrade,
  type AiGradeResult,
} from '@/lib/grading/ai-postprocess'
import { normalizeText, wordCount } from '@/lib/grading/normalize'
import { parseMarkdown } from '@/lib/import/rules'
import { ruleDraftToPaper, suggestPaperId, suggestYear, validateDraft, type DraftIssue, type PaperMeta } from '@/lib/import/draft'
import { mergeAiItems, parseGroupWithAi } from '@/lib/import/ai'

// ai_jobs 队列(SPEC §9.1:数据库表 + 应用内轮询工作线程,不引 Redis)。
//   grade  —— 主观题(short_answer / translate_e2c / writing)评分与 translate_c2e_fill 兜底
//   explain —— 小题解析草稿(§5.4,教师在导入向导确认后才写回 item)
// 约束(§5.3):空答案不调 AI;同一小题 + 同一规范化答案按哈希缓存不重复计费;
// confidence < 0.6 或调用失败 → needs_review;AI 未配置时不崩溃,直接分流待评;教师评分是终评。
// 正确性要点(评审 2026-09-13):送评答案在入队时快照进 payload,缓存键与快照一致;执行前先查
// 缓存;写回前核对学生答案未变且不是教师终评(否则作废 superseded);running 超时回收;
// 工作线程有界并发;注入嫌疑强制复核且不入缓存。

export const MAX_ATTEMPTS = 3
const RETRY_BACKOFF_S = 5 // 第 n 次失败后至少等 n×5 秒再重试
const RUNNING_RECLAIM_S = 300 // running 超过 5 分钟(> 单次 AI 超时)视为悬挂,回收重跑

export interface GradeJobPayload {
  kind: 'grade'
  attemptId: string
  responseId: string
  itemId: string
  mode: 'subjective' | 'c2e_fallback'
  /** 入队时的学生答案快照:执行、缓存、写回都以它为准 */
  answer: string
  hash: string
  promptVersion: string
}
export interface ExplainJobPayload {
  kind: 'explain'
  itemId: string
}
/** docx 导入(M5):Markdown → 规则切分 → 逐题组 AI 补答案 / 解析 → 试卷 JSON 草稿 + 问题清单 */
export interface ParseJobPayload {
  kind: 'parse'
  markdown: string
  filename: string
  meta?: Partial<PaperMeta>
  createdBy: string
}
export type AiJobPayload = GradeJobPayload | ExplainJobPayload | ParseJobPayload
type AiJobRow = typeof aiJobs.$inferSelect

export interface AiModels {
  gradingModel: string
  authoringModel: string
}

export interface EnqueueOutcome {
  jobId: string | null
  /** 命中缓存:结果已直接写回 responses,未入队 */
  cached: boolean
  /** 答案为空:直接 0 分,未入队 */
  empty: boolean
}

function parseItem(row: typeof items.$inferSelect): Item | null {
  const parsed = itemSchema.safeParse({
    number: row.number,
    type: row.type,
    score: row.score,
    explanation: row.explanation ?? undefined,
    knowledgeTags: row.knowledgeTags,
    difficulty: row.difficulty as 1 | 2 | 3,
    contextSnippet: row.contextSnippet ?? undefined,
    content: row.content,
    answer: row.answer,
  })
  return parsed.success ? parsed.data : null
}

async function stimulusOf(db: Db, groupId: string): Promise<string | null> {
  const g = await db.query.groups.findFirst({ where: eq(groups.id, groupId) })
  const st = g?.stimulus as { body?: string; title?: string } | null
  if (!st?.body) return null
  return st.title ? `${st.title}\n${st.body}` : st.body
}

/** 常见错答计数(§5.4):规范化错误答案 +1(空答/超词不入)。 */
export async function recordWrongAnswer(db: Db, itemId: string, normalized: string): Promise<void> {
  if (!normalized) return
  await db
    .insert(wrongAnswers)
    .values({ itemId, normalizedAnswer: normalized })
    .onConflictDoUpdate({
      target: [wrongAnswers.itemId, wrongAnswers.normalizedAnswer],
      set: { count: sql`${wrongAnswers.count} + 1`, lastSeenAt: new Date() },
    })
}

/**
 * 把评分结果写回 responses(AI 或缓存)。只在「学生答案仍是送评快照」且「不是教师终评」时写;
 * 否则返回 false(结果作废,调用方记 superseded)。
 */
export async function applyGradeToResponse(
  db: Db,
  responseId: string,
  item: Item,
  result: AiGradeResult,
  needsReview: boolean,
  meta: { source: 'ai' | 'cache'; model: string; mode: GradeJobPayload['mode']; expectAnswer?: string },
): Promise<boolean> {
  const current = await db.query.responses.findFirst({ where: eq(responses.id, responseId) })
  if (!current) return false
  if (current.gradeSource === 'teacher') return false
  if (meta.expectAnswer !== undefined) {
    const now = studentAnswerText(studentAnswerSchema.safeParse(current.answer).data ?? null)
    if (now !== meta.expectAnswer) return false
  }
  const verdict = meta.mode === 'c2e_fallback' ? (result.score >= item.score ? 'correct' : 'wrong') : 'graded'
  await db
    .update(responses)
    .set({
      score: result.score,
      gradeSource: 'ai',
      feedback: result.feedback || null,
      needsReview,
      gradeDetail: {
        verdict,
        ai: {
          score: result.score,
          keyPointsHit: result.keyPointsHit,
          issues: result.issues,
          confidence: result.confidence,
          model: meta.model,
          source: meta.source,
          promptVersion: PROMPT_VERSION,
        },
      },
    })
    .where(and(eq(responses.id, responseId), or(isNull(responses.gradeSource), ne(responses.gradeSource, 'teacher'))))
  return true
}

/** attempt 总分 = 已判小题得分之和(客观 + AI/教师);待评的不计。 */
export async function recomputeAttemptScore(db: Db, attemptId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${responses.score}), 0)` })
    .from(responses)
    .where(eq(responses.attemptId, attemptId))
  const total = Number(row?.total ?? 0)
  await db.update(attempts).set({ totalScore: total }).where(eq(attempts.id, attemptId))
  return total
}

/**
 * 标记「待老师评」(AI 不可用 / 多次失败 / 结构不合法 / 注入嫌疑):主观题不给分等老师;
 * 汉译英兜底按 §5.2「AI 不可用时记 0 并 needs_review」。教师终评不覆盖。
 */
async function markNeedsReview(db: Db, responseId: string, reason: string, score: number | null = null): Promise<void> {
  await db
    .update(responses)
    .set({ score, needsReview: true, gradeDetail: { verdict: 'needs_review', ai: { error: reason, promptVersion: PROMPT_VERSION } } })
    .where(and(eq(responses.id, responseId), or(isNull(responses.gradeSource), ne(responses.gradeSource, 'teacher'))))
}

/**
 * 入队一次评分。先查缓存(命中即写回、不计费);同 response 已有同快照的未完成任务则复用;
 * 空答案直接 0 分(§5.3)。返回 jobId=null 表示无需等待。
 */
export async function enqueueGradeJob(
  db: Db,
  args: { attemptId: string; responseId: string; itemId: string; mode: GradeJobPayload['mode'] },
): Promise<EnqueueOutcome> {
  const resp = await db.query.responses.findFirst({ where: eq(responses.id, args.responseId) })
  const itemRow = await db.query.items.findFirst({ where: eq(items.id, args.itemId) })
  const item = itemRow ? parseItem(itemRow) : null
  if (!resp || !item || !gradePromptFor(item)) {
    if (resp) await markNeedsReview(db, resp.id, 'item_invalid')
    return { jobId: null, cached: false, empty: false }
  }
  if (resp.gradeSource === 'teacher') return { jobId: null, cached: false, empty: false }
  const answer = studentAnswerText(studentAnswerSchema.safeParse(resp.answer).data ?? null)
  if (answer.trim() === '') {
    await db
      .update(responses)
      .set({ score: 0, gradeSource: 'auto', gradeDetail: { verdict: 'empty' }, needsReview: false })
      .where(eq(responses.id, resp.id))
    await recomputeAttemptScore(db, args.attemptId)
    return { jobId: null, cached: false, empty: true }
  }
  const hash = answerHash(args.itemId, answer, PROMPT_VERSION)

  const hit = await db.query.aiGradeCache.findFirst({
    where: and(eq(aiGradeCache.itemId, args.itemId), eq(aiGradeCache.answerHash, hash)),
  })
  if (hit) {
    const post = postprocessAiGrade(hit.result, item.score)
    if (post.ok) {
      await applyGradeToResponse(db, resp.id, item, post.result, post.needsReview, { source: 'cache', model: hit.model, mode: args.mode, expectAnswer: answer })
      await recomputeAttemptScore(db, args.attemptId)
      return { jobId: null, cached: true, empty: false }
    }
  }

  const pending = await db.query.aiJobs.findFirst({
    where: and(
      eq(aiJobs.kind, 'grade'),
      inArray(aiJobs.status, ['queued', 'running']),
      sql`${aiJobs.payload}->>'responseId' = ${resp.id}`,
      sql`${aiJobs.payload}->>'hash' = ${hash}`,
    ),
  })
  if (pending) return { jobId: pending.id, cached: false, empty: false }

  const payload: GradeJobPayload = {
    kind: 'grade',
    attemptId: args.attemptId,
    responseId: resp.id,
    itemId: args.itemId,
    mode: args.mode,
    answer,
    hash,
    promptVersion: PROMPT_VERSION,
  }
  // 待评状态(成绩页显示「等 AI 评分」)。
  await db.update(responses).set({ score: null, gradeDetail: { verdict: 'pending' }, needsReview: false }).where(eq(responses.id, resp.id))
  const [job] = await db.insert(aiJobs).values({ kind: 'grade', payload }).returning({ id: aiJobs.id })
  return { jobId: job?.id ?? null, cached: false, empty: false }
}

/** 解析任务:同一小题已有未完成的 explain 任务则复用(教师重复点击不重复计费)。 */
export async function enqueueExplainJob(db: Db, itemId: string): Promise<string> {
  const pending = await db.query.aiJobs.findFirst({
    where: and(eq(aiJobs.kind, 'explain'), inArray(aiJobs.status, ['queued', 'running']), sql`${aiJobs.payload}->>'itemId' = ${itemId}`),
  })
  if (pending) return pending.id
  const payload: ExplainJobPayload = { kind: 'explain', itemId }
  const [job] = await db.insert(aiJobs).values({ kind: 'explain', payload }).returning({ id: aiJobs.id })
  if (!job) throw new Error('入队失败')
  return job.id
}

export async function enqueueParseJob(db: Db, payload: Omit<ParseJobPayload, 'kind'>): Promise<string> {
  const [job] = await db.insert(aiJobs).values({ kind: 'parse', payload: { kind: 'parse', ...payload } satisfies ParseJobPayload }).returning({ id: aiJobs.id })
  if (!job) throw new Error('入队失败')
  return job.id
}

/**
 * 领取一条待处理任务(FOR UPDATE SKIP LOCKED,多实例安全):queued 按 attempts 退避;
 * running 超过 RUNNING_RECLAIM_S 视为进程崩溃遗留,回收重跑(attempts 同样 +1,超限即失败分流)。
 */
export async function claimNextJob(db: Db): Promise<AiJobRow | null> {
  const rows = await db.execute<AiJobRow>(sql`
    update ai_jobs set status = 'running', attempts = attempts + 1, updated_at = now()
    where id = (
      select id from ai_jobs
      where (status = 'queued' and updated_at <= now() - (attempts * ${RETRY_BACKOFF_S}) * interval '1 second')
         or (status = 'running' and updated_at <= now() - ${RUNNING_RECLAIM_S} * interval '1 second')
      order by created_at
      limit 1
      for update skip locked
    )
    returning id, kind, payload, status, attempts, result, error, created_at as "createdAt", updated_at as "updatedAt"
  `)
  const list = (rows as unknown as { rows?: AiJobRow[] }).rows ?? (rows as unknown as AiJobRow[])
  return list[0] ?? null
}

function isTransient(e: unknown): boolean {
  if (!(e instanceof AiError)) return false
  if (e.kind === 'timeout' || e.kind === 'network') return true
  if (e.kind === 'http') return e.status === 429 || (e.status ?? 0) >= 500
  return false
}

async function finishJob(db: Db, job: AiJobRow, status: 'done' | 'failed' | 'queued', patch: { result?: unknown; error?: string | null }) {
  await db
    .update(aiJobs)
    .set({ status, result: patch.result ?? job.result, error: patch.error ?? null, updatedAt: new Date() })
    .where(eq(aiJobs.id, job.id))
}

async function runGradeJob(db: Db, job: AiJobRow, payload: GradeJobPayload, ai: AiCaller | null, model: string): Promise<'done' | 'failed' | 'retry'> {
  const failScore = payload.mode === 'c2e_fallback' ? 0 : null
  const resp = await db.query.responses.findFirst({ where: eq(responses.id, payload.responseId) })
  const itemRow = await db.query.items.findFirst({ where: eq(items.id, payload.itemId) })
  const item = itemRow ? parseItem(itemRow) : null
  const promptName = item ? gradePromptFor(item) : null
  if (!resp || !item || !itemRow || !promptName) {
    if (resp) await markNeedsReview(db, resp.id, 'item_invalid')
    await finishJob(db, job, 'failed', { error: 'item_invalid' })
    return 'failed'
  }
  // 送评答案 = 入队快照(旧任务无快照则取当前答案);哈希与快照一致。
  const answer = typeof payload.answer === 'string' ? payload.answer : studentAnswerText(studentAnswerSchema.safeParse(resp.answer).data ?? null)
  const hash = answerHash(payload.itemId, answer, PROMPT_VERSION)
  if (answer.trim() === '') {
    await applyEmpty(db, resp.id, answer, payload.attemptId)
    await finishJob(db, job, 'done', { result: { skipped: 'empty' } })
    return 'done'
  }
  // 执行前再查缓存:先后入队的相同答案只计费一次(§5.3)。
  const hit = await db.query.aiGradeCache.findFirst({ where: and(eq(aiGradeCache.itemId, payload.itemId), eq(aiGradeCache.answerHash, hash)) })
  if (hit) {
    const post = postprocessAiGrade(hit.result, item.score)
    if (post.ok) {
      const applied = await applyGradeToResponse(db, resp.id, item, post.result, post.needsReview, { source: 'cache', model: hit.model, mode: payload.mode, expectAnswer: answer })
      await recomputeAttemptScore(db, payload.attemptId)
      await finishJob(db, job, 'done', { result: { cached: true, applied } })
      return 'done'
    }
  }
  if (!ai) {
    await markNeedsReview(db, resp.id, 'ai_not_configured', failScore)
    await recomputeAttemptScore(db, payload.attemptId)
    await finishJob(db, job, 'failed', { error: 'ai_not_configured' })
    return 'failed'
  }
  const suspicious = looksLikeInjection(answer)
  const stimulus = item.type === 'short_answer' ? await stimulusOf(db, itemRow.groupId) : null
  const words = item.type === 'writing' ? wordCount(answer) : undefined
  try {
    const out = await ai({
      model,
      system: loadPrompt(promptName),
      user: buildGradeUser(item, answer, { stimulus, words }),
      maxTokens: item.type === 'writing' ? 900 : 500,
    })
    const post = postprocessAiGrade(extractJson(out.text), item.score)
    if (!post.ok) throw new AiError(post.error, 'bad_response')
    let result = post.result
    let needsReview = post.needsReview
    if (item.type === 'writing') {
      result = applyWritingWordFloor(result, words ?? 0, item.content.minWords, item.score, item.answer.rubric)
    }
    if (payload.mode === 'c2e_fallback') {
      result = { ...result, score: foldBinary(result.score, item.score) }
    }
    if (suspicious) {
      needsReview = true
      result = { ...result, issues: [...result.issues, '答案含疑似对阅卷者的指令，已转老师复核'] }
    } else {
      await db.insert(aiGradeCache).values({ itemId: payload.itemId, answerHash: hash, result, model: out.model }).onConflictDoNothing()
    }
    const applied = await applyGradeToResponse(db, resp.id, item, result, needsReview, { source: 'ai', model: out.model, mode: payload.mode, expectAnswer: answer })
    if (applied && payload.mode === 'c2e_fallback' && result.score === 0) {
      await recordWrongAnswer(db, payload.itemId, normalizeText(answer))
    }
    await recomputeAttemptScore(db, payload.attemptId)
    await finishJob(db, job, 'done', {
      result: { grade: result, needsReview, applied, suspicious, usage: out.usage, latencyMs: out.latencyMs, model: out.model },
    })
    // 成本日志:只记题号级信息与 token 数,不记学生内容(§9.5 个人信息最小化)。
    console.log(
      `[ai] grade job=${job.id} item=${item.number} type=${item.type} model=${out.model} tokens=${out.usage.promptTokens}+${out.usage.completionTokens} ms=${out.latencyMs} review=${needsReview}${applied ? '' : ' superseded'}`,
    )
    return 'done'
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isTransient(e) && job.attempts < MAX_ATTEMPTS) {
      await finishJob(db, job, 'queued', { error: msg })
      return 'retry'
    }
    await markNeedsReview(db, resp.id, msg, failScore)
    if (payload.mode === 'c2e_fallback') await recordWrongAnswer(db, payload.itemId, normalizeText(answer))
    await recomputeAttemptScore(db, payload.attemptId)
    await finishJob(db, job, 'failed', { error: msg })
    console.warn(`[ai] grade job=${job.id} failed after ${job.attempts} attempts: ${msg}`)
    return 'failed'
  }
}

async function applyEmpty(db: Db, responseId: string, expectAnswer: string, attemptId: string): Promise<void> {
  const current = await db.query.responses.findFirst({ where: eq(responses.id, responseId) })
  if (!current || current.gradeSource === 'teacher') return
  const now = studentAnswerText(studentAnswerSchema.safeParse(current.answer).data ?? null)
  if (now !== expectAnswer) return
  await db.update(responses).set({ score: 0, gradeSource: 'auto', gradeDetail: { verdict: 'empty' }, needsReview: false }).where(eq(responses.id, responseId))
  await recomputeAttemptScore(db, attemptId)
}

async function runExplainJob(db: Db, job: AiJobRow, payload: ExplainJobPayload, ai: AiCaller | null, model: string): Promise<'done' | 'failed' | 'retry'> {
  if (!ai) {
    await finishJob(db, job, 'failed', { error: 'ai_not_configured' })
    return 'failed'
  }
  const itemRow = await db.query.items.findFirst({ where: eq(items.id, payload.itemId) })
  const item = itemRow ? parseItem(itemRow) : null
  if (!item || !itemRow) {
    await finishJob(db, job, 'failed', { error: 'item_invalid' })
    return 'failed'
  }
  try {
    const stimulus = await stimulusOf(db, itemRow.groupId)
    const out = await ai({ model, system: loadPrompt('explain-item'), user: buildExplainUser(item, { stimulus }), maxTokens: 600 })
    const parsed = aiExplainResultSchema.safeParse(extractJson(out.text))
    if (!parsed.success) throw new AiError('解析结果结构不合法', 'bad_response')
    await finishJob(db, job, 'done', { result: { explain: parsed.data, usage: out.usage, latencyMs: out.latencyMs, model: out.model } })
    console.log(`[ai] explain job=${job.id} item=${item.number} model=${out.model} tokens=${out.usage.promptTokens}+${out.usage.completionTokens} ms=${out.latencyMs}`)
    return 'done'
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isTransient(e) && job.attempts < MAX_ATTEMPTS) {
      await finishJob(db, job, 'queued', { error: msg })
      return 'retry'
    }
    await finishJob(db, job, 'failed', { error: msg })
    return 'failed'
  }
}

/**
 * docx 导入任务:规则切分永远执行(AI 未配置也能得到可校对的草稿);AI 可用时逐题组补答案 / 解析,
 * 单个题组失败只记问题不拖垮整卷。结果 = 试卷 JSON 草稿 + 问题清单 + 原文 Markdown。
 */
async function runParseJob(db: Db, job: AiJobRow, payload: ParseJobPayload, ai: AiCaller | null, model: string): Promise<'done' | 'failed' | 'retry'> {
  const rule = parseMarkdown(payload.markdown)
  const year = payload.meta?.year ?? suggestYear(rule.title)
  const title = payload.meta?.title ?? rule.title ?? payload.filename.replace(/\.docx$/i, '')
  const meta: PaperMeta = {
    id: payload.meta?.id ?? suggestPaperId(title, year),
    title,
    year,
    region: payload.meta?.region ?? (/湖北/.test(title) ? '湖北' : ''),
    durationMinutes: payload.meta?.durationMinutes ?? 120,
    source: payload.filename,
    status: 'draft',
  }
  const { paper, issues } = ruleDraftToPaper(rule, meta)
  const aiIssues: DraftIssue[] = []
  let aiCalls = 0
  if (ai) {
    for (let si = 0; si < paper.sections.length; si++) {
      const sec = paper.sections[si]!
      for (let gi = 0; gi < sec.groups.length; gi++) {
        const g = sec.groups[gi]!
        if (g.items.length === 0) continue
        try {
          const items = await parseGroupWithAi(ai, model, sec, g, rule.answerKey)
          aiCalls++
          aiIssues.push(...mergeAiItems(paper, si, gi, items))
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          aiIssues.push({ path: `sections.${si}.groups.${gi}`, message: `AI 结构化失败:${msg},请手动填写答案`, source: 'ai' })
        }
      }
    }
  } else {
    aiIssues.push({ path: '', message: 'AI 未配置:答案与解析需手动填写', source: 'ai' })
  }
  const validated = validateDraft(paper, [...issues, ...aiIssues])
  await finishJob(db, job, 'done', {
    result: {
      draft: paper,
      issues: validated.issues,
      valid: validated.ok,
      answerKey: rule.answerKey,
      markdown: payload.markdown,
      aiUsed: !!ai,
      aiCalls,
    },
  })
  console.log(`[ai] parse job=${job.id} sections=${paper.sections.length} items=${paper.sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.items.length, 0), 0)} aiCalls=${aiCalls} issues=${validated.issues.length}`)
  return 'done'
}

/** 执行一条任务;ai 为 null 表示未配置 → 直接分流待评(不重试)。 */
export async function runJob(db: Db, job: AiJobRow, ai: AiCaller | null, models: AiModels): Promise<'done' | 'failed' | 'retry'> {
  const payload = job.payload as AiJobPayload
  if (payload.kind === 'grade') return runGradeJob(db, job, payload, ai, models.gradingModel)
  if (payload.kind === 'parse') return runParseJob(db, job, payload, ai, models.authoringModel)
  return runExplainJob(db, job, payload, ai, models.authoringModel)
}

/**
 * 工作线程一轮:先连续领取最多 max 条,再以有界并发执行(FOR UPDATE SKIP LOCKED 已保证
 * 不重复领取)。任何未预期异常(如 DB 断连)都把任务放回 queued(超限则 failed),不留 running 悬挂。
 */
export async function processAiJobs(
  db: Db,
  ai: AiCaller | null,
  models: AiModels,
  opts: { max?: number; concurrency?: number } = {},
): Promise<{ done: number; failed: number; retry: number }> {
  const stat = { done: 0, failed: 0, retry: 0 }
  const max = opts.max ?? 5
  const concurrency = Math.max(1, opts.concurrency ?? 4)
  const claimed: AiJobRow[] = []
  for (let i = 0; i < max; i++) {
    const job = await claimNextJob(db)
    if (!job) break
    claimed.push(job)
  }
  const safeRun = async (job: AiJobRow) => {
    try {
      return await runJob(db, job, ai, models)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const status = job.attempts < MAX_ATTEMPTS ? 'queued' : 'failed'
      await finishJob(db, job, status, { error: `unexpected: ${msg}` }).catch(() => undefined)
      console.error(`[ai] job=${job.id} 未预期异常(${status}):`, msg)
      return status === 'queued' ? 'retry' : 'failed'
    }
  }
  for (let i = 0; i < claimed.length; i += concurrency) {
    const batch = claimed.slice(i, i + concurrency)
    const results = await Promise.all(batch.map(safeRun))
    for (const r of results) stat[r]++
  }
  return stat
}
