import { getCurrentUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import * as offeringRepo from '@/lib/repo/offerings'
import { loadReviewWorkbench } from '@/lib/domain/review-load'
import { buildExportScores, fillSchoolTemplate, type ExportReport } from '@/lib/domain/review-export'

// 学校平台成绩文件端点:POST 学校模板 xls/xlsx。
// - mode=preview → 只回对账报告 JSON(不走 server action:action 有 1MB 体积上限,大模板会
//   把「预览」卡死;本端点无此限制,预览/下载同一条代码路径,报告口径绝不分叉)。
// - 默认 → 附件回已填文件,并在 X-Export-Report 头带回本次实算的报告计数(纯数字,无 PII),
//   客户端与预览计数比对,数据在预览后被改动时能当场发现。
// 行列保真由 domain 保证(只改成绩格的值)。错误以 i18n key 文本 + 4xx 返回,客户端翻译展示。
const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024 // 模板正常几十 KB;10MB 兜住异常/恶意大文件

const reportCounts = (rep: ExportReport) =>
  JSON.stringify({ t: rep.templateRows, m: rep.matchedRows, f: rep.filledCells, u: rep.unmatched.length, x: rep.missing.length })

export async function POST(req: Request, { params }: { params: Promise<{ offeringId: string }> }) {
  const user = await getCurrentUser()
  if (!user || user.role === 'STUDENT') return new Response('Forbidden', { status: 403 })
  const { offeringId: oid } = await params
  const offeringId = Number(oid)
  if (!Number.isInteger(offeringId)) return new Response('err.notFound', { status: 404 })

  const prisma = await getDb()
  const offering = await offeringRepo.findForSchoolWithCourseClass(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) return new Response('err.notFound', { status: 404 })

  const formData = await req.formData()
  const file = formData.get('file')
  if (!file || typeof file === 'string') return new Response('err.pickExcel', { status: 400 })
  if (file.size > MAX_TEMPLATE_BYTES) return new Response('rexp.errTooBig', { status: 413 })

  const actor = { schoolId: user.schoolId, userId: user.userId, role: user.role }
  const data = await loadReviewWorkbench(prisma, { id: offering.id, classId: offering.classId }, actor)
  const res = fillSchoolTemplate(await file.arrayBuffer(), file.name, buildExportScores(data))
  if (!res.ok) return new Response(res.error, { status: 400 })

  if (formData.get('mode') === 'preview') {
    return Response.json({ report: res.report })
  }

  const xlsx = /\.xlsx$/i.test(file.name)
  const ext = xlsx ? 'xlsx' : 'xls'
  const utf8Name = encodeURIComponent(`${offering.class.name}-成绩导入-已填.${ext}`)
  // Uint8Array<ArrayBufferLike> 不满足 BodyInit:slice() 复制出独立 ArrayBuffer。
  return new Response(res.out.slice().buffer as ArrayBuffer, {
    headers: {
      'Content-Type': xlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.ms-excel',
      'Content-Disposition': `attachment; filename="review-export-${offering.id}.${ext}"; filename*=UTF-8''${utf8Name}`,
      'X-Export-Report': reportCounts(res.report),
      'Cache-Control': 'no-store',
    },
  })
}
