import { APP_VERSION_SHORT } from '@/lib/config'

// 当前在线版本号（部署时注入的 git SHA，截短到 12 位——不暴露完整 40 位精确指纹）。前端
// 自动更新闸会拉这个接口和自己内置的版本号比对，发现已发新版就整页刷新。必须 no-store，
// 且每次实时由运行中的 Worker 返回，这样旧版客户端总能问到「线上最新版」。闸与本接口必须
// 用同一个 APP_VERSION_SHORT，同一构建内才恒等、不会误刷。
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(
    { version: APP_VERSION_SHORT },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
  )
}
