import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'
import pg from 'pg'

// 硬约束 1:参考答案与评分要点永远不发往客户端。
//
// 它是九条硬约束里排第一的、而且是安全性质:这套题库给未成年人用,手机可能是共用的,
// 漏一条参考答案就等于把这场考试作废。此前只被抽查过 `/api/attempts/:id` 一个接口
// (2026-09-14 的首轮预演),而学生够得着、且会返回题目内容的接口有七条。
//
// 这里扫两层:
//   (a) **禁用字段名** —— accepted / reference / keyPoints / rubric / sample / distractors
//   (b) **真实答案字符串本身** —— 直接从库里取出这份卷的全部参考答案与解析,
//       逐字在响应里找。不管它被塞进哪个字段、叫什么名字,都跑不掉。(b) 才是真正的网。
//
// 纯 HTTP,不开浏览器。需要 E2E_BASE_URL 与能直连的 DATABASE_URL。
test.skip(!process.env.E2E_BASE_URL || !process.env.DATABASE_URL, '设 E2E_BASE_URL 与 DATABASE_URL 后运行')

const PAPER = 'hubei-zsb-english-2025'
const FORBIDDEN_KEYS = ['accepted', 'reference', 'keyPoints', 'rubric', 'sample', 'distractors']
/**
 * 这些字段是枚举,不参与「答案原文」匹配 —— 种子卷第 22 题的正确答案字面就是 `wrong`,
 * 会跟 verdict 的取值撞车。是值扫描固有的碰撞,不是泄漏。
 */
const ENUM_FIELDS = ['verdict', 'status', 'type', 'kind', 'mode', 'code', 'source', 'gradeSource', 'role']

/** 从库里取出这份卷所有参考答案 / 解析里的字符串(长度 ≥ 5,避开 a / for 这种误报)。 */
async function loadSecrets(): Promise<Set<string>> {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    const rows = (await c.query(`select answer, explanation from items where paper_id=$1`, [PAPER])).rows
    const out = new Set<string>()
    const walk = (v: unknown) => {
      if (typeof v === 'string') {
        const s = v.trim()
        if (s.length >= 5) out.add(s)
      } else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    for (const r of rows) {
      walk(r.answer)
      if (r.explanation) walk(r.explanation)
    }
    return out
  } finally {
    await c.end()
  }
}

function findLeaks(body: unknown, secrets: Set<string>, allowKeys: string[] = []): string[] {
  const hits: string[] = []
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') {
      const lastKey = path.split('.').pop() ?? ''
      if (!ENUM_FIELDS.includes(lastKey) && secrets.has(v.trim())) hits.push(`答案原文出现在 ${path}:${JSON.stringify(v.slice(0, 40))}`)
      return
    }
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`))
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (FORBIDDEN_KEYS.includes(k) && !allowKeys.includes(k)) hits.push(`禁用字段 ${path}.${k}`)
        walk(val, `${path}.${k}`)
      }
    }
  }
  walk(body, '')
  return hits
}

interface Session {
  get(path: string): Promise<import('@playwright/test').APIResponse>
  post(path: string, data?: unknown): Promise<import('@playwright/test').APIResponse>
  dispose(): Promise<void>
}

/**
 * 会话 cookie 带着 `secure`(生产构建下),而 Playwright 的 API 上下文不肯在 http:// 上回传它 ——
 * 于是「登录了」的每一次请求其实都是 401。第一版就栽在这儿:扫的全是错误页,而错误页里
 * 当然没有答案,整条用例成了一块只会亮绿灯的装饰(变异验证时才发现)。
 * 这里显式把 cookie 取出来手动带上,不依赖 cookie 策略的细节。
 */
async function login(role: 'student' | 'teacher'): Promise<Session> {
  const ctx: APIRequestContext = await pwRequest.newContext({ baseURL: process.env.E2E_BASE_URL })
  const res = await ctx.post('/api/auth/dev-login', { data: { role } })
  expect(res.status(), `${role} 开发登录应当成功`).toBe(200)
  const cookie = res
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value.split(';')[0])
    .join('; ')
  expect(cookie, '登录应当下发会话 cookie,否则后面扫的全是 401 错误页').toBeTruthy()
  return {
    get: (path) => ctx.get(path, { headers: { cookie } }),
    post: (path, data) => ctx.post(path, { headers: { cookie }, ...(data === undefined ? {} : { data }) }),
    dispose: () => ctx.dispose(),
  }
}

test('学生够得着的接口,一个字的参考答案都不漏', async () => {
  const secrets = await loadSecrets()
  expect(secrets.size, '库里得先有答案,否则这条用例是空转').toBeGreaterThan(20)

  const student = await login('student')
  const started = await student.post('/api/attempts', { paperId: PAPER, mode: 'exam' })
  expect(started.status(), '开卷应当成功').toBe(200)
  const attemptId = (await started.json()).attemptId as string
  expect(attemptId, '拿不到 attemptId 就没什么可扫的').toBeTruthy()

  /**
   * 扫一条接口。`expectShape` 是**防空转**的:响应必须真的带着题目内容,
   * 否则「没扫到泄漏」只说明这次根本没拿到东西。
   */
  const noLeak = async (label: string, path: string, expectShape?: (body: Record<string, unknown>) => void) => {
    const res = await student.get(path)
    expect(res.status(), `${label} 应当是 200,不是 ${res.status()} —— 否则这条扫描是空转`).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expectShape?.(body)
    expect(findLeaks(body, secrets), `${label} 漏了`).toEqual([])
  }
  const hasItems = (key: string) => (body: Record<string, unknown>) =>
    expect((body[key] as unknown[] | undefined)?.length, `${key} 是空的,扫了也白扫`).toBeGreaterThan(0)

  await noLeak('开卷', `/api/attempts/${attemptId}`, (b) => {
    const paper = b.paper as { sections?: { groups?: { items?: unknown[] }[] }[] }
    const n = (paper.sections ?? []).flatMap((s) => s.groups ?? []).flatMap((g) => g.items ?? []).length
    expect(n, '开卷居然一道题都没有,扫了也白扫').toBeGreaterThan(0)
  })
  await noLeak('任务列表', '/api/assignments')
  await noLeak('我的信息', '/api/me')
  await noLeak('我的统计', '/api/me/stats')
  // 训练与复习取题:这两条不走 stripAssembledAnswers,是另一份独立的剥离实现,最容易漂。
  await noLeak('每日训练取题', '/api/training/next?mode=daily&count=10', hasItems('items'))
  await noLeak('专项训练取题', '/api/training/next?mode=targeted&type=fill&count=10', hasItems('items'))
  await noLeak('错题复习', '/api/review') // 新账号没有到期错题,due 为空是正常的

  expect((await student.post(`/api/attempts/${attemptId}/submit`)).status(), '交卷应当成功').toBe(200)
  await noLeak('成绩页(老师还没发布)', `/api/attempts/${attemptId}/result`, hasItems('sections'))

  await student.dispose()
})

test('学生打教师接口一律被挡(那些接口带着完整答案)', async () => {
  const student = await login('student')
  for (const path of [
    `/api/teacher/papers/${PAPER}`,
    `/api/teacher/items?paperId=${PAPER}`,
    '/api/teacher/classes',
    '/api/teacher/assignments',
    '/api/teacher/grading/queue',
    '/api/teacher/items/candidates',
  ]) {
    const res = await student.get(path)
    // 不接受 401:我们是**登录着的学生**,拿到 401 说明会话没带上,这条用例就又变成空转了。
    expect([403, 404], `${path} 应当被挡成 403/404,实际 ${res.status()}(401 = 会话没带上,用例空转)`).toContain(res.status())
  }
  await student.dispose()
})
