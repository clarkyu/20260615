import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// 每个写接口都得在界面上有入口。
//
// 起因是同一个 bug 连着出现两次,形状一模一样:**每一块都对,合起来点不到**。
//   · 登出(D74):`/api/auth/logout` 有接口、SW 有「见到 /api/auth/* 就清个人缓存」的逻辑、
//     e2e 还专门验过那条清理 —— 全站却没有一个「退出」按钮,应用登不出去。
//   · 生成解析(D76):`POST /api/teacher/items/:id/explain` 有接口、有提示词、有 worker、
//     有去重入队、有测试,SPEC §9.4 也列着 —— 老师在题库页却没地方点。
// 两次都不是哪一块写错了,所以单测、类型、lint 全都拦不住:每个零件的用例都是绿的。
//
// 只查**写**接口(POST/PUT/PATCH/DELETE),因为一个写接口就是一个用户动作:没人调用它,
// 就是一个用户做不到的动作。只读接口不算数 —— SPEC §9.4 规定的接口面里,
// 学情 / 批改队列 / 班级详情这些本就被服务端组件直接查库渲染(SSR),接口是给外部用的,
// 没有界面调用方很正常。把只读接口也算进来,只会逼出一张越来越长的豁免名单,
// 那种「靠豁免名单维持绿色」的用例守不住任何东西(D72)。
//
// 豁免要写清楚「谁在调用」,不是「我不想改」。

const ROOT = path.resolve(__dirname, '..', '..')
const API_DIR = path.join(ROOT, 'src', 'app', 'api')

/** 调用方不在 src 里的写接口。每条都得说清楚谁调用,否则就是上面那种豁免名单。 */
const EXTERNAL_CALLERS: Record<string, string> = {
  // 无:目前所有写接口都由界面调用。健康检查 /api/health 是 GET,不在本用例范围内。
}

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

interface Route {
  /** 形如 `auth/logout`、`teacher/items/[id]/explain` */
  route: string
  methods: string[]
}

function routes(): Route[] {
  const out: Route[] = []
  for (const file of walk(API_DIR)) {
    if (path.basename(file) !== 'route.ts') continue
    const src = readFileSync(file, 'utf-8')
    const methods = WRITE_METHODS.filter((m) => new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\s*\\(`).test(src))
    out.push({ route: path.relative(API_DIR, path.dirname(file)).split(path.sep).join('/'), methods })
  }
  return out.sort((a, b) => a.route.localeCompare(b.route))
}

/** 界面侧的全部源码(路由自身不算调用方:接口里出现自己的路径不代表有人点得到)。 */
function callerSources(): string[] {
  return walk(path.join(ROOT, 'src'))
    .filter((f) => !f.startsWith(API_DIR + path.sep))
    .map((f) => readFileSync(f, 'utf-8'))
}

/**
 * **注释里提到的路径不算调用方。** 这一条是这个用例的命门:第一版没有它,于是
 * `LogoutButton.tsx` 顶上那句「POST /api/auth/logout —— 用 POST 而不是链接」、
 * `ItemTools.tsx` 里那句「SPEC §9.4 也列着 POST /api/teacher/items/:id/explain」
 * 自己就把自己这条接口「喂绿」了 —— 把两个入口都删掉,用例照样全绿。
 * 变异验证抓出来的;没跑变异的话,这就是一条**专门为本轮 bug 写的、却抓不住本轮 bug** 的用例。
 * `[^:]` 那一处是为了不误伤 `https://` 里的双斜杠。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * 路径里的动态段(`[id]`)在调用方那边是模板串(`${itemId}`)或别的表达式,所以换成通配。
 * 通配不跨引号 / 空格 / 反引号,免得把两条不同的路径匹配成一条。
 */
function callerOf(route: string, sources: string[]): boolean {
  const pattern = '/api/' + route.replace(/\./g, '\\.').replace(/\[[^\]]+\]/g, '[^\'"`\\s)]+')
  const rx = new RegExp(pattern)
  return sources.some((s) => rx.test(stripComments(s)))
}

describe('写接口的可达性', () => {
  const all = routes()
  const sources = callerSources()
  const writes = all.filter((r) => r.methods.length > 0)

  // ── 先证明这个扫描本身不是空的(#489 / D72 的教训:扫描型用例最容易「全绿但什么都没查」)──
  it('扫描器确实扫到了东西', () => {
    expect(all.length).toBeGreaterThanOrEqual(35)
    expect(writes.length).toBeGreaterThanOrEqual(15)
    expect(sources.length).toBeGreaterThanOrEqual(50)
    // 点名两条:一条曾经没人调用(登出)、一条一直有人调用(开发登录)。
    expect(all.map((r) => r.route)).toContain('auth/logout')
    expect(writes.map((r) => r.route)).toContain('teacher/items/[id]/explain')
  })

  it('正向对照:能认出带模板串的调用方,也不会把不同路径认混', () => {
    // 认得出 fetch(`/api/teacher/items/${itemId}`) 这种写法
    expect(callerOf('teacher/items/[id]', ['await fetch(`/api/teacher/items/${itemId}`, { method: "PUT" })'])).toBe(true)
    // 不会把 /api/teacher/items/generate 当成 /api/teacher/items/[id]/explain 的调用方
    expect(callerOf('teacher/items/[id]/explain', ["fetch('/api/teacher/items/generate', { method: 'POST' })"])).toBe(false)
    // 通配不跨引号:拼接出来的路径不算调用方(动态段这里才真的用上通配)
    expect(callerOf('teacher/items/[id]', ["fetch('/api/teacher/items/' + id)"])).toBe(false)
    // 也不会因为前缀相同就算数
    expect(callerOf('auth/logout', ["fetch('/api/auth/login')"])).toBe(false)
    // 注释里提到不算调用方 —— 这一条是本用例的命门,见 stripComments 上方的说明
    expect(callerOf('auth/logout', ["// 退出走 POST /api/auth/logout，不是链接"])).toBe(false)
    expect(callerOf('teacher/items/[id]/explain', ['/* SPEC §9.4：POST /api/teacher/items/:id/explain */'])).toBe(false)
    expect(callerOf('auth/logout', ['{/* 登出见 /api/auth/logout */}'])).toBe(false)
    // 但真调用方紧跟在注释后面时不能被吃掉
    expect(callerOf('auth/logout', ["// 登出\nawait fetch('/api/auth/logout', { method: 'POST' })"])).toBe(true)
    // 也不能误伤带 https:// 的行
    expect(callerOf('auth/logout', ["const doc = 'https://x/y'\nfetch('/api/auth/logout')"])).toBe(true)
  })

  it('每个写接口都有界面入口', () => {
    const unreachable = writes
      .filter((r) => !EXTERNAL_CALLERS[r.route] && !callerOf(r.route, sources))
      .map((r) => `${r.methods.join('/')} /api/${r.route}`)
    expect(
      unreachable,
      `这些写接口没有任何界面调用 —— 要么补入口,要么在 EXTERNAL_CALLERS 里写清楚谁在调用:\n${unreachable.join('\n')}`,
    ).toEqual([])
  })

  it('豁免名单里不许有已经失效的条目', () => {
    const stale = Object.keys(EXTERNAL_CALLERS).filter((r) => !writes.some((w) => w.route === r))
    expect(stale, `豁免的接口已经不存在或不再是写接口:${stale.join(', ')}`).toEqual([])
  })
})
