import { requireTeacherPage } from '@/lib/auth/teacher'
import { ImportWizard } from '@/components/teacher/ImportWizard'

export const dynamic = 'force-dynamic'

// 导入向导(SPEC §8):上传 docx → 解析 → 校对 → 保存。
export default async function TeacherImport() {
  await requireTeacherPage()
  return (
    <main>
      <h1 className="text-2xl font-bold">导入 Word 试卷</h1>
      <div className="mt-4">
        <ImportWizard />
      </div>
    </main>
  )
}
