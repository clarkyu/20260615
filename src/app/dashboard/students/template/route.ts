import * as XLSX from 'xlsx'
import { getCurrentUser } from '@/lib/auth'

// A ready-to-fill roster import template (.xlsx) — header row + one example. Generated
// server-side so SheetJS stays out of the client bundle. Staff-only.
export async function GET() {
  const user = await getCurrentUser()
  if (!user || user.role === 'STUDENT') return new Response('Forbidden', { status: 403 })

  const headers = ['学号', '姓名', '班级', '院系', '专业', '年级', '手机号', '邮箱']
  const example = ['2024001', '张三', '计算机2401', '信息学院', '软件工程', '2024', '13800000000', 'zhangsan@example.com']
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  ws['!cols'] = headers.map(() => ({ wch: 14 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '学生名单')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // ASCII filename for compatibility + a UTF-8 filename* for the Chinese name.
      'Content-Disposition': "attachment; filename=\"roster-template.xlsx\"; filename*=UTF-8''%E5%AD%A6%E7%94%9F%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx",
      'Cache-Control': 'no-store',
    },
  })
}
