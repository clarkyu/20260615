import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

// 性能预算核查(SPEC §7.7 / §10 M7:学生端路由首屏 JS ≤ 200 KB gzip)。
// 读 .next/app-build-manifest.json 拿到每个路由的首屏 JS 文件,逐个 gzip 后求和(去重)。
// 用法:pnpm build && pnpm budget;超预算退出码 1(CI 会红)。

const LIMIT_BYTES = Number(process.env.JS_BUDGET_BYTES ?? '') || 200 * 1024
// 学生在手机上会打开的路由(教师端是桌面,不在预算内)
const STUDENT_ROUTES = ['/page', '/play/[attemptId]/page', '/result/[attemptId]/page', '/train/page']

interface AppBuildManifest {
  pages: Record<string, string[]>
}

function gzipSize(file: string): number {
  return gzipSync(readFileSync(file), { level: 9 }).length
}

function main() {
  const root = process.cwd()
  const manifestPath = join(root, '.next', 'app-build-manifest.json')
  let manifest: AppBuildManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as AppBuildManifest
  } catch {
    console.error(`找不到 ${manifestPath},先跑 pnpm build`)
    process.exit(1)
  }

  const cache = new Map<string, number>()
  const sizeOf = (rel: string): number => {
    const hit = cache.get(rel)
    if (hit !== undefined) return hit
    const abs = join(root, '.next', rel)
    let n = 0
    try {
      if (statSync(abs).isFile()) n = gzipSize(abs)
    } catch {
      n = 0
    }
    cache.set(rel, n)
    return n
  }

  // 路由名可能带路由组前缀,如 /(student)/page;按去掉组名后的路径匹配。
  const strip = (p: string) => p.replace(/\/\([^)]+\)/g, '')
  const rows: Array<{ route: string; files: number; bytes: number }> = []
  for (const want of STUDENT_ROUTES) {
    const key = Object.keys(manifest.pages).find((k) => strip(k) === want)
    if (!key) {
      console.error(`预算核查:构建产物里没有路由 ${want}(路由改名了?请更新 scripts/check-budget.ts)`)
      process.exit(1)
    }
    const files = [...new Set(manifest.pages[key]!.filter((f) => f.endsWith('.js')))]
    rows.push({ route: strip(key), files: files.length, bytes: files.reduce((n, f) => n + sizeOf(f), 0) })
  }

  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`
  console.log(`学生端首屏 JS(gzip)预算 ${kb(LIMIT_BYTES)}:`)
  let over = 0
  for (const r of rows) {
    const ok = r.bytes <= LIMIT_BYTES
    if (!ok) over++
    console.log(`  ${ok ? '✓' : '✗'} ${r.route.padEnd(28)} ${kb(r.bytes).padStart(10)}  (${r.files} 个文件, 占预算 ${Math.round((r.bytes / LIMIT_BYTES) * 100)}%)`)
  }
  if (over > 0) {
    console.error(`\n有 ${over} 个学生端路由超出首屏 JS 预算(${kb(LIMIT_BYTES)}),请拆包或去掉重依赖。`)
    process.exit(1)
  }
  console.log('\n全部在预算内。')
}

main()
