---
name: ui-review
description: Launch this app locally and screenshot it in a real (mobile) browser for UI review. Use when asked to run/start/screenshot the app, look at the UI, or do a UI/UX design review. Covers seeding a local D1, booting `next dev`, driving Chromium with Playwright at a phone viewport, and a design-review checklist. (你好！作业 / Hi-Homework — Next.js App Router + OpenNext on Cloudflare + D1/R2.)
---

# UI 评审：把 app 跑起来在真机视口截图

This app is a **mobile-first PWA**. Review it at a phone viewport (≈390×844), not desktop.
Chromium + Playwright are pre-installed in this environment (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); do **not** run `playwright install`.

## 1. Seed a local D1 + boot the dev server

```bash
node e2e/seed.mjs                 # applies local D1 migrations + seeds school/teacher/student (idempotent)
SESSION_SECRET='e2e-session-secret-at-least-32-characters-long' NODE_ENV=development \
  npx next dev -p 3123            # run in background; first hit compiles a route (slow in DEV only)
# wait until ready:
until [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3123/login)" = 200 ]; do sleep 3; done
```

Seeded test accounts (password **`e2e-pass-123`**), school **「E2E 测试学校」**:
- Teacher 工号 **`T1`** (王老师) → lands on `/dashboard`
- Student 学号 **`2025001`** (张三) → lands on `/student`

Login flow: `/login` → `selectOption('select[name="schoolId"]', {label:'E2E 测试学校'})` → fill `input[name="identifier"]` + `input[name="password"]` → click `button[type="submit"]`.

> The seed only creates school + teacher + student + one class. The teacher has **no offerings/bank/assignments**, so rich screens (assignment form, bank, grading) show empty states. To see them, seed an offering + bank set (see §3).

## 2. Screenshot with Playwright (mobile viewport)

Write the script **inside the repo** (so it resolves project `node_modules`) and import from `@playwright/test`; output PNGs to the scratchpad. Skeleton:

```js
import { chromium } from '@playwright/test'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'zh-CN' })
const page = await ctx.newPage()
// login as T1, then page.goto(...) + page.screenshot({ path, fullPage: true }) per screen
await b.close()
```
Run with `node your-script.mjs` from the repo root. **Look at every screenshot** — a blank/skeleton frame means the page didn't finish (in DEV the first hit per route compiles for seconds; navigate, then wait ~1s before shooting).

Worth shooting: `/login`, `/dashboard`, `/dashboard/teaching`, `/dashboard/teaching/new-assignment` (the 3-step wizard — step 2 「环节」holds submit-kinds + 评分配置), `/dashboard/bank` + `/dashboard/bank/1` (per-sentence 中英 toggle), `/student`.

## 3. Optional: seed an offering + bank set (to render the rich screens)

```bash
TS='2026-06-01T00:00:00.000+00:00'
cat > /tmp/seed2.sql <<SQL
INSERT OR REPLACE INTO Course (id,schoolId,name,code,createdAt) VALUES (1,1,'综合英语','ENG101','$TS');
INSERT OR REPLACE INTO CourseOffering (id,schoolId,courseId,teacherId,classId,year,semester,createdAt) VALUES (1,1,1,1,1,'2025-2026','1','$TS');
INSERT OR REPLACE INTO ChunkSet (id,schoolId,name,createdAt) VALUES (1,1,'示例句集','$TS');
INSERT OR REPLACE INTO Chunk (id,chunkSetId,"order",english,chinese,meaningEn,meaningZh,exampleEn,exampleZh) VALUES (1,1,1,'Practice makes perfect.','熟能生巧。',NULL,NULL,NULL,NULL);
SQL
npx wrangler d1 execute recitation-db --local --file=/tmp/seed2.sql
```
(`"order"` must be quoted — reserved word.) After this, `/dashboard/teaching/new-assignment` renders the full AssignmentForm.

## 4. Design-review checklist (what to look for)

- **品牌一致性**：靛蓝/violet 主色、圆角卡片、`你好！作业` logo——是否统一、是否「AI 套路货」。
- **移动端密度**：单屏内容是否过载？长表单（如环节编辑）的进阶项是否折叠（`高级设置` / `评分配置` 用 `<details>`）。
- **空 / 加载状态**：每个列表都该有友好的空状态（带图标 + CTA），不要停在骨架屏。注意：DEV 模式的骨架屏多半是**冷编译**假象，不是 bug——以生产构建为准。
- **点击区**：头部图标（暗色/EN/登出）、底部导航的可点区域是否够大（≥44px）。
- **i18n**：zh/en/es 三语都要看；切到 EN 检查没漏译/截断。
- **暗色模式**：点头部月亮图标，检查对比度。
- **可访问性**：表单控件有 `aria-label`，错误用 `role="alert"`。

## 5. Cleanup (always)

```bash
pkill -f "next dev -p 3123"; pkill -f next-server
rm -f your-script.mjs            # don't commit scratch scripts
git checkout tsconfig.json       # `next build`/`dev` rewrites jsx:preserve→react-jsx; revert it
```

> The red **「1 Issue」** badge in DEV screenshots is Next.js's dev overlay (here: local `APP_URL` unset) — **not** a UI bug; absent in production.
