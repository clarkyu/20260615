import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { DevLoginButton } from '@/components/home/StartPractice'

export const dynamic = 'force-dynamic'

// 教师登录页:Casdoor OIDC 在 M7 接入;开发环境用快捷登录。
export default async function TeacherLogin() {
  const session = await getSession()
  if (session.user && (session.user.role === 'teacher' || session.user.role === 'admin')) redirect('/teacher')
  return (
    <main className="mx-auto max-w-md py-10">
      <h1 className="text-2xl font-bold">教师登录</h1>
      <p className="mt-2 text-sm text-neutral-500">统一身份登录（Casdoor）接入中；开发环境可用下面的快捷登录。</p>
      {process.env.AUTH_DEV_LOGIN === 'true' ? (
        <div className="mt-4">
          <DevLoginButton role="teacher" label="以教师身份登录（开发）" />
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">当前环境未开放开发登录，请等待统一身份登录上线。</p>
      )}
    </main>
  )
}
