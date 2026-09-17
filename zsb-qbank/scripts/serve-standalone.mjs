// 按生产镜像的布局跑 `output: standalone` 产物 —— 也就是线上真正在跑的那个东西。
//
// 为什么要有这个脚本:`pnpm start` 跑的是 `next start`,而 Dockerfile 里跑的是
// `node .next/standalone/server.js`。两者不是同一个产物 —— next 自己在
// `output: standalone` 下启动 `next start` 时就会警告这一点。CI 与本地预演一直用前者,
// 于是**真正要部署的产物从没被启动过**(2026-09-17 第一次实跑,结论是好的,
// 但这个口子该堵上:测的应当就是要发的)。
//
// Dockerfile 的运行层是三块拼起来的,这里照搬:
//   .next/standalone/*  →  根目录(server.js、node_modules 子集、prompts)
//   .next/static        →  .next/static(standalone 不含它)
//   public              →  public(sw.js、图标在这儿)
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const ROOT = process.cwd()
const SA = join(ROOT, '.next', 'standalone')
if (!existsSync(join(SA, 'server.js'))) {
  console.error('没找到 .next/standalone/server.js —— 先跑 pnpm build。')
  process.exit(1)
}

for (const [from, to] of [
  [join(ROOT, '.next', 'static'), join(SA, '.next', 'static')],
  [join(ROOT, 'public'), join(SA, 'public')],
]) {
  if (!existsSync(from)) continue
  rmSync(to, { recursive: true, force: true }) // 可重复执行
  cpSync(from, to, { recursive: true })
}

/**
 * Next 是按 **cwd** 找 `.env*` 的,而 server.js 必须以 .next/standalone 为 cwd 跑 ——
 * 那个目录里没有 `.env.local`,于是本地起来后每个请求都报「SESSION_SECRET 未配置」。
 * 所以这里把项目根的 env 文件读出来喂给子进程(真实环境变量优先,和 Next 的口径一致)。
 * 生产不受影响:Docker 里的变量由 compose 注入,本来就不靠 .env 文件。
 * **不**把 .env.local 拷进产物目录 —— 密钥不该落进构建产物。
 */
function envFromFiles() {
  const out = {}
  for (const name of ['.env', '.env.local']) {
    const f = join(ROOT, name)
    if (!existsSync(f)) continue
    for (const raw of readFileSync(f, 'utf8').split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 0) continue
      out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    }
  }
  return out
}

const child = spawn(process.execPath, ['server.js'], {
  cwd: SA,
  stdio: 'inherit',
  env: { ...envFromFiles(), ...process.env, NODE_ENV: 'production' },
})
child.on('exit', (code) => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
