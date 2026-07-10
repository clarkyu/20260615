import { getCurrentUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import * as offeringRepo from '@/lib/repo/offerings'
import { loadReviewWorkbench } from '@/lib/domain/review-load'
import { buildExportScores, fillSchoolTemplate } from '@/lib/domain/review-export'

// 学校平台成绩文件下载:POST 学校模板 xls/xlsx → 回填三列成绩 → 以附件回同格式文件。
// 行列保真由 domain 保证(只改成绩格的值)。错误以 i18n key 文本 + 400 返回,客户端翻译展示。
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

  const actor = { schoolId: user.schoolId, userId: user.userId, role: user.role }
  const data = await loadReviewWorkbench(prisma, { id: offering.id, classId: offering.classId }, actor)
  const res = fillSchoolTemplate(await file.arrayBuffer(), file.name, buildExportScores(data))
  if (!res.ok) return new Response(res.error, { status: 400 })

  const xlsx = /\.xlsx$/i.test(file.name)
  const ext = xlsx ? 'xlsx' : 'xls'
  const utf8Name = encodeURIComponent(`${offering.class.name}-成绩导入-已填.${ext}`)
  // Uint8Array<ArrayBufferLike> 不满足 BodyInit:slice() 复制出独立 ArrayBuffer。
  return new Response(res.out.slice().buffer as ArrayBuffer, {
    headers: {
      'Content-Type': xlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.ms-excel',
      'Content-Disposition': `attachment; filename="review-export-${offering.id}.${ext}"; filename*=UTF-8''${utf8Name}`,
      'Cache-Control': 'no-store',
    },
  })
}
