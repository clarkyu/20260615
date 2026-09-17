import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// 环境变量的三方一致性(硬约束 9「`.env.example` 列出全部变量并注释」;SPEC §9.6 部署)。
//
// 一个环境变量在这个项目里要对三处:
//   1. 代码里读它            src/**、scripts/**
//   2. `.env.example` 里声明  —— 否则 clark 部署时根本不知道有这个旋钮
//   3. `docker-compose.yml` 的 app 服务转发  —— **漏了这条最阴**:变量在 .env 里填了、
//      看着像生效了,可 compose 不往容器里传,生产上那个旋钮就是**静默失效**的。
//      日志不会报错,行为只是「没按预期变」,几乎不可能靠肉眼发现。
//
// 2026-09-17 逐条对过一次,三处当时是齐的(18 个运行时变量)。这个用例是防它以后跑偏:
// 加一个 env 旋钮而忘了改 compose,在这里当场变红,而不是等部署完在课堂上发现。

const ROOT = path.resolve(__dirname, '..', '..')

/** 由运行时/镜像提供,不是给人填的配置。 */
const RUNTIME_PROVIDED = new Set(['NODE_ENV', 'NEXT_RUNTIME', 'PORT', 'HOSTNAME', 'NEXT_TELEMETRY_DISABLED'])
/** 只在容器外跑的工具读它(构建期预算脚本),不必进 compose。 */
const TOOL_ONLY = new Set(['JS_BUDGET_BYTES'])
/** 只被宿主机/容器里的 bash 脚本读,不经过 TS —— 扫不到,但该在 .env.example 里有。 */
const SHELL_ONLY = ['BACKUP_DIR', 'KEEP_DAYS']
/** compose 自己用来拼 DATABASE_URL 的,app 服务不直接收。 */
const COMPOSE_ONLY = new Set(['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(p)
  }
  return out
}

/**
 * 代码里有两种读法,都要扫到:
 *   · `process.env.X`
 *   · `env.X` —— 配置读取函数的写法(`getAiConfig(env = process.env)`、`getOidcConfig`),
 *     只扫 `process.env.` 会把 AI_* 与 CASDOOR_* 整片漏掉。
 */
function scanCode(): Set<string> {
  const found = new Set<string>()
  for (const file of [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'scripts'))]) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) found.add(m[1] as string)
    for (const m of src.matchAll(/\benv\.([A-Z][A-Z0-9_]{2,})/g)) found.add(m[1] as string)
  }
  return found
}

/** 解析 .env.example:返回变量名,以及「它所在的那一组前面有没有注释」。 */
function parseEnvExample(): { names: Set<string>; undocumented: string[] } {
  const names = new Set<string>()
  const undocumented: string[] = []
  let blockDocumented = false
  for (const raw of readFileSync(path.join(ROOT, '.env.example'), 'utf8').split('\n')) {
    const line = raw.trim()
    if (line === '') {
      blockDocumented = false
      continue
    }
    if (line.startsWith('#')) {
      blockDocumented = true
      continue
    }
    const name = line.split('=')[0]?.trim()
    if (!name) continue
    names.add(name)
    // 一段注释管一组变量(CASDOOR_CLIENT_ID 跟在 ISSUER 的注释下面),所以看的是「这一组」。
    if (!blockDocumented) undocumented.push(name)
  }
  return { names, undocumented }
}

/** docker-compose.yml 的 app 服务往容器里转发了哪些变量。 */
function parseComposeAppEnv(): Set<string> {
  const lines = readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8').split('\n')
  const out = new Set<string>()
  let inApp = false
  let inEnv = false
  for (const line of lines) {
    if (/^ {2}\S+:/.test(line)) {
      inApp = line.startsWith('  app:')
      inEnv = false
      continue
    }
    if (!inApp) continue
    if (/^ {4}\S+:/.test(line)) {
      inEnv = line.startsWith('    environment:')
      continue
    }
    if (!inEnv) continue
    const m = /^ {6}([A-Z][A-Z0-9_]*):/.exec(line)
    if (m) out.add(m[1] as string)
  }
  return out
}

const scanned = scanCode()
const { names: declared, undocumented } = parseEnvExample()
const forwarded = parseComposeAppEnv()
/** 需要人来填、且要送进容器的那些。 */
const runtimeVars = [...scanned].filter((v) => !RUNTIME_PROVIDED.has(v) && !TOOL_ONLY.has(v)).sort()

describe('扫描本身不能是空的', () => {
  // 这三条是防「正则写错 → 一个都没扫到 → 下面全部空过」。#489 的空断言教训。
  it('扫到的变量数量像回事', () => {
    expect(scanned.size, `只扫到 ${[...scanned].join(', ')}`).toBeGreaterThanOrEqual(15)
  })
  it('两种读法都扫到了', () => {
    expect(scanned, 'process.env.X 这种').toContain('DATABASE_URL')
    expect(scanned, 'env.X 这种(getAiConfig / getOidcConfig)').toContain('AI_BASE_URL')
    expect(scanned).toContain('CASDOOR_ISSUER')
  })
  it('三个文件都解析出了东西', () => {
    expect(declared.size).toBeGreaterThanOrEqual(15)
    expect(forwarded.size).toBeGreaterThanOrEqual(15)
    expect(runtimeVars.length).toBeGreaterThanOrEqual(15)
  })
})

describe('三方一致', () => {
  it('代码读的每个变量,.env.example 里都有(硬约束 9)', () => {
    const missing = runtimeVars.filter((v) => !declared.has(v))
    expect(missing, `代码里读了但 .env.example 没写:${missing.join(', ')}`).toEqual([])
  })

  it('代码读的每个变量,compose 都往容器里转发了', () => {
    // 漏一个 = 那个旋钮在生产上静默失效:不报错,只是不按预期工作。
    const missing = runtimeVars.filter((v) => !forwarded.has(v))
    expect(missing, `代码里读了但 docker-compose 的 app 没转发:${missing.join(', ')}`).toEqual([])
  })

  it('bash 脚本读的那几个也在 .env.example 里', () => {
    // backup.sh / restore.sh 读它们,TS 扫不到,但 clark 要知道有这两个旋钮。
    const missing = SHELL_ONLY.filter((v) => !declared.has(v))
    expect(missing, `脚本用了但 .env.example 没写:${missing.join(', ')}`).toEqual([])
  })

  it('.env.example 里没有已经没人读的陈货', () => {
    const known = new Set([...runtimeVars, ...SHELL_ONLY, ...COMPOSE_ONLY])
    const stale = [...declared].filter((v) => !known.has(v))
    expect(stale, `.env.example 里写着但代码/脚本/compose 都不读:${stale.join(', ')}`).toEqual([])
  })

  // 硬约束 9 的「并注释」这半条,只守得到**分组**这一层:
  // `.env.example` 是「一段注释管一组变量」的写法(CASDOOR_CLIENT_ID / _SECRET 都跟在
  // ISSUER 的注释下面),所以「某个变量被塞进已有分组、自己没被提到」这种,这里查不出来。
  // 别把断言名写得比它本事大 —— 它能挡的是「空行之后直接起一个没有任何说明的变量」。
  it('没有变量是孤零零冒出来的:每一组变量前面都有注释', () => {
    expect(undocumented, `这些变量所在的分组前面没有注释:${undocumented.join(', ')}`).toEqual([])
  })
})
