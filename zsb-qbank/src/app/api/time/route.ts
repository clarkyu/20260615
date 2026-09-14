import { NextResponse } from 'next/server'

// GET /api/time(SPEC §7.7):只回服务端时间。iOS 微信把页面切到后台会冻结定时器,
// 回到前台时作答页用它重新校准倒计时(考试计时以服务端 deadline_at 为准,硬约束 6)。
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ serverNow: new Date().toISOString() }, { headers: { 'cache-control': 'no-store' } })
}
