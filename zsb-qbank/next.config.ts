import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  // 本仓库是「宿主仓库 + zsb-qbank 子目录」:外层还有一份 lockfile,Next 会把工作区根推断到外层,
  // standalone 产物就会多嵌一层 zsb-qbank/。显式钉在本目录,产物布局在本地与 Docker 里一致
  // (server.js 固定在 .next/standalone/server.js),Dockerfile 的 COPY 才不会错位。
  outputFileTracingRoot: __dirname,
  // pg 只在 Node 运行时用(instrumentation 工作线程、API 路由);不让 webpack 打包它,
  // 否则 dev 模式按 edge 目标编译 instrumentation 时会因 pg 依赖 fs/pg-native 而失败。
  serverExternalPackages: ['pg'],
  // AI 提示词以文件形式放在 prompts/(SPEC §5.3),运行时用 fs 读取;standalone 产物需显式带上。
  outputFileTracingIncludes: { '/*': ['./prompts/**/*'] },
  // instrumentation.ts 会被同时按 edge 目标编译(dev 尤甚):register() 已按 NEXT_RUNTIME 早退,
  // 但 webpack 仍会静态跟进动态 import 里的 Node-only 依赖;edge 编译时把它们置空即可。
  webpack: (config, { nextRuntime }) => {
    if (nextRuntime === 'edge') {
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        pg: false,
        'pg-native': false,
        crypto: false,
        fs: false,
        path: false,
      }
    }
    return config
  },
  // 微信内置浏览器缓存激进:HTML 一律 no-cache,静态资源靠内容哈希(SPEC §7.7)。
  async headers() {
    return [
      {
        source: '/((?!_next/static|_next/image).*)',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
    ]
  },
}

export default nextConfig
