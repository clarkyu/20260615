import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db/client'
import { enqueueParseJob } from '@/lib/db/ai-jobs'
import { docxToMarkdown, MAX_DOCX_BYTES } from '@/lib/import/docx'
import { MAX_INFLATED_BYTES, summarizeZip } from '@/lib/import/zip-check'
import { requireTeacherApi } from '@/lib/auth/teacher'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// POST /api/teacher/papers/import(SPEC §9.4):multipart 上传 docx → mammoth/turndown 转 Markdown →
// 入 ai_jobs(kind=parse);返回 jobId 与 Markdown,前端轮询 GET /api/teacher/jobs/:id 拿草稿进校对页。
export async function POST(req: NextRequest) {
  const auth = await requireTeacherApi(req)
  if (!auth.ok) return auth.res
  if (!rateLimit(`import:${auth.ctx.user.sub}`, 10)) {
    return NextResponse.json({ error: { code: 'rate_limited', message: '上传太频繁，稍后再试' } }, { status: 429 })
  }
  // 先看声明的请求体大小,超限不必把整个 multipart 读进内存。
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_DOCX_BYTES + 64 * 1024) return NextResponse.json({ error: { code: 'bad_request', message: '文件超过 8 MB' } }, { status: 413 })
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: '请用 multipart/form-data 上传文件' } }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: { code: 'bad_request', message: '缺少 file 字段' } }, { status: 400 })
  if (!/\.docx$/i.test(file.name)) return NextResponse.json({ error: { code: 'bad_request', message: '只支持 .docx 文件' } }, { status: 400 })
  if (file.size > MAX_DOCX_BYTES) return NextResponse.json({ error: { code: 'bad_request', message: '文件超过 8 MB' } }, { status: 400 })
  const buf = Buffer.from(await file.arrayBuffer())
  // docx 是 zip:魔数 PK
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return NextResponse.json({ error: { code: 'bad_request', message: '不是有效的 docx 文件' } }, { status: 400 })
  // 解压前看中央目录:不是 docx 结构、或解压后总量超限(zip bomb)都不交给 mammoth。
  const zip = summarizeZip(buf)
  if (!zip || !zip.hasDocumentXml) return NextResponse.json({ error: { code: 'bad_request', message: '不是有效的 docx 文件' } }, { status: 400 })
  if (zip.inflatedBytes > MAX_INFLATED_BYTES) return NextResponse.json({ error: { code: 'bad_request', message: '文档内容过大，请拆分后再上传' } }, { status: 413 })
  let md: { markdown: string; warnings: string[] }
  try {
    md = await docxToMarkdown(buf)
  } catch (e) {
    return NextResponse.json({ error: { code: 'bad_request', message: `docx 解析失败：${e instanceof Error ? e.message : String(e)}` } }, { status: 400 })
  }
  if (md.markdown.trim().length < 50) return NextResponse.json({ error: { code: 'bad_request', message: '文档内容为空' } }, { status: 400 })
  const meta: Record<string, unknown> = {}
  for (const k of ['id', 'title', 'region'] as const) {
    const v = form.get(k)
    if (typeof v === 'string' && v.trim()) meta[k] = v.trim()
  }
  for (const k of ['year', 'durationMinutes'] as const) {
    const v = form.get(k)
    if (typeof v === 'string' && /^\d+$/.test(v)) meta[k] = Number(v)
  }
  const jobId = await enqueueParseJob(getDb(), { markdown: md.markdown, filename: file.name, meta, createdBy: auth.ctx.userId })
  return NextResponse.json({ jobId, markdown: md.markdown, warnings: md.warnings })
}
