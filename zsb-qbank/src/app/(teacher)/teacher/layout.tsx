import Link from 'next/link'

// 教师端壳(SPEC §8:桌面优先、追求效率):顶部导航 + 宽容器。鉴权由各页自行 requireTeacherPage。
const NAV: Array<[string, string]> = [
  ['/teacher', '概览'],
  ['/teacher/papers', '试卷'],
  ['/teacher/bank', '题库'],
  ['/teacher/import', '导入'],
  ['/teacher/classes', '班级'],
  ['/teacher/assignments', '任务'],
  ['/teacher/grading', '批改'],
  ['/teacher/stats', '学情'],
]

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-2 text-sm">
          <span className="mr-4 font-bold">专升本英语题库 · 教师端</span>
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="rounded-lg px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="mx-auto w-full max-w-6xl px-4 py-6">{children}</div>
    </div>
  )
}
