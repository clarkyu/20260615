import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'

// 数据库表结构(SPEC §9.3)。题目内容/答案存 JSONB,形状由 src/lib/schema 的 zod 校验
// (唯一事实来源);这里只负责关系与索引。

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  casdoorSub: text('casdoor_sub').notNull(),
  phone: text('phone'),
  name: text('name'),
  role: text('role', { enum: ['student', 'teacher', 'admin'] }).notNull().default('student'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('users_casdoor_sub_uq').on(t.casdoorSub)])

export const classes = pgTable('classes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  joinCode: text('join_code').notNull(),
  teacherId: uuid('teacher_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('classes_join_code_uq').on(t.joinCode)])

export const classMembers = pgTable('class_members', {
  classId: uuid('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.classId, t.userId] })])

export const papers = pgTable('papers', {
  id: text('id').primaryKey(), // 例:hubei-zsb-english-2025
  title: text('title').notNull(),
  year: integer('year').notNull(),
  region: text('region').notNull(),
  source: text('source'),
  totalScore: real('total_score').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  status: text('status', { enum: ['draft', 'published', 'archived'] }).notNull().default('draft'),
  answerKeyNote: text('answer_key_note'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sections = pgTable('sections', {
  id: uuid('id').primaryKey().defaultRandom(),
  paperId: text('paper_id').notNull().references(() => papers.id, { onDelete: 'cascade' }),
  order: integer('order').notNull(),
  code: text('code').notNull(),
  title: text('title').notNull(),
  instructions: text('instructions').notNull(),
  itemType: text('item_type').notNull(),
  scorePerItem: real('score_per_item').notNull(),
}, (t) => [index('sections_paper_idx').on(t.paperId)])

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  sectionId: uuid('section_id').notNull().references(() => sections.id, { onDelete: 'cascade' }),
  order: integer('order').notNull(),
  kind: text('kind', { enum: ['cloze', 'reading_fill', 'reading_qa', 'standalone'] }).notNull(),
  stimulus: jsonb('stimulus'),
  frame: text('frame'),
}, (t) => [index('groups_section_idx').on(t.sectionId)])

export const items = pgTable('items', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  sectionId: uuid('section_id').notNull().references(() => sections.id, { onDelete: 'cascade' }),
  paperId: text('paper_id').notNull().references(() => papers.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  type: text('type').notNull(),
  score: real('score').notNull(),
  content: jsonb('content').notNull(),
  answer: jsonb('answer').notNull(),
  explanation: text('explanation'),
  knowledgeTags: text('knowledge_tags').array().notNull().default([]),
  difficulty: integer('difficulty').notNull().default(2),
  contextSnippet: text('context_snippet'),
  origin: text('origin', { enum: ['official', 'teacher', 'ai'] }).notNull().default('official'),
  status: text('status', { enum: ['draft', 'approved'] }).notNull().default('approved'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('items_paper_number_uq').on(t.paperId, t.number),
  index('items_type_idx').on(t.type),
  index('items_tags_gin').using('gin', t.knowledgeTags),
])

export const assignments = pgTable('assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  classId: uuid('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
  paperId: text('paper_id').references(() => papers.id),
  itemIds: uuid('item_ids').array(),
  mode: text('mode', { enum: ['practice', 'training', 'exam'] }).notNull(),
  title: text('title').notNull(),
  opensAt: timestamp('opens_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  durationMinutes: integer('duration_minutes'),
  settings: jsonb('settings'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const attempts = pgTable('attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  paperId: text('paper_id').references(() => papers.id),
  assignmentId: uuid('assignment_id').references(() => assignments.id),
  mode: text('mode', { enum: ['practice', 'training', 'exam'] }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  status: text('status', { enum: ['in_progress', 'submitted', 'graded', 'released'] }).notNull().default('in_progress'),
  totalScore: real('total_score'),
  focusLostCount: integer('focus_lost_count').notNull().default(0),
  clientMeta: jsonb('client_meta'),
}, (t) => [index('attempts_user_idx').on(t.userId)])

export const responses = pgTable('responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  attemptId: uuid('attempt_id').notNull().references(() => attempts.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  answer: jsonb('answer').notNull(),
  clientUpdatedAt: timestamp('client_updated_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  score: real('score'),
  gradeSource: text('grade_source', { enum: ['auto', 'ai', 'teacher'] }),
  gradeDetail: jsonb('grade_detail'),
  feedback: text('feedback'),
  needsReview: boolean('needs_review').notNull().default(false),
}, (t) => [uniqueIndex('responses_attempt_item_uq').on(t.attemptId, t.itemId)])

export const wrongAnswers = pgTable('wrong_answers', {
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  normalizedAnswer: text('normalized_answer').notNull(),
  count: integer('count').notNull().default(1),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.itemId, t.normalizedAnswer] })])

export const reviewCards = pgTable('review_cards', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  intervalDays: integer('interval_days').notNull().default(1),
  ease: real('ease').notNull().default(2.5),
  streak: integer('streak').notNull().default(0),
  lapses: integer('lapses').notNull().default(0),
  lastResult: text('last_result'),
}, (t) => [primaryKey({ columns: [t.userId, t.itemId] })])

export const aiJobs = pgTable('ai_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind', { enum: ['grade', 'explain', 'generate', 'parse'] }).notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status', { enum: ['queued', 'running', 'done', 'failed'] }).notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  result: jsonb('result'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('ai_jobs_status_idx').on(t.status, t.createdAt)])
