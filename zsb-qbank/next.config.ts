import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
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
