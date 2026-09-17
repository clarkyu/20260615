import Link from 'next/link'
import { getSession } from '@/lib/auth/session'
import { LogoutButton } from '@/components/auth/LogoutButton'

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

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  // 登录页也套这层壳:以学生身份误登进来的人,要能在这儿换账号(那页会提示没有教师权限)。
  const user = (await getSession()).user

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
          {user ? (
            <span className="ml-auto flex items-center gap-3">
              <span className="max-w-40 truncate text-neutral-500">{user.name}</span>
              <LogoutButton label="退出" to="/teacher/login" />
            </span>
          ) : null}
        </nav>
      </header>
      <div className="mx-auto w-full max-w-6xl px-4 py-6">{children}</div>
    </div>
  )
}
