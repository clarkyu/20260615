import { NextResponse, type NextRequest } from 'next/server'
import { config } from '@/lib/config'
import { timingSafeEqual } from '@/lib/safe-compare'
import { purgeFiles } from '@/lib/ai/providers/gemini'

// 维护端点(CRON_SECRET 鉴权):清空 Gemini File API 存储。评阅把视频传到 File API,而它有
// 20 GiB/项目 的存储硬顶、文件约 48h 才过期——历史上评完不删,一个高峰就堆满、之后所有上传
// 全被拒(期末考核 20260707 卡死全场)。感知路径已改为「用完即删」根治;本端点一次性清掉历史
// 堆积。默认单次最多删 500 个,返回 remaining=true 就再按一次,直到 remaining=false。
//   curl -X POST $APP/api/admin/purge-gemini-files \
//     -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" -d '{}'
export async function POST(req: NextRequest) {
  const secret = config.cronSecret()
  if (!secret || !timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: { max?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    /* empty body is fine — use the default cap */
  }
  const max = Number.isInteger(body.max) && (body.max as number) > 0 ? (body.max as number) : 500

  try {
    const res = await purgeFiles(max)
    return NextResponse.json({ ok: true, ...res }, { status: 200 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'purge failed' }, { status: 502 })
  }
}
