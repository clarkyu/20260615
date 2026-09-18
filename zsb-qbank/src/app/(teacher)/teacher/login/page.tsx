import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { devLoginEnabled } from '@/lib/auth/dev-login'
import { loginErrorMessage, oidcConfigured } from '@/lib/auth/oidc'
import { DevLoginButton } from '@/components/home/StartPractice'
import { LoginButton } from '@/components/auth/LoginButton'

export const dynamic = 'force-dynamic'

// 教师登录页:优先统一身份登录(Casdoor);未配置时回落到开发登录(生产应关掉)。
export default async function TeacherLogin({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const session = await getSession()
  if (session.user && (session.user.role === 'teacher' || session.user.role === 'admin')) redirect('/teacher')
  const sp = await searchParams
  const errMsg = loginErrorMessage(sp.err)
  const oidc = oidcConfigured()
  const devLogin = devLoginEnabled()
  return (
    <main className="mx-auto max-w-md py-10">
      <h1 className="text-2xl font-bold">教师登录</h1>
      {errMsg ? (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {errMsg}
          <span className="mt-1 block text-red-600/80 dark:text-red-400/80">管理员可在服务端日志里看到具体原因（搜「casdoor 登录失败」）。</span>
        </p>
      ) : null}
      {session.user ? (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          当前账号是「{session.user.name}」（学生），没有教师权限。换个账号登录，或联系管理员把你加进教师组。
        </p>
      ) : null}
      {oidc ? (
        <div className="mt-5">
          <LoginButton returnTo="/teacher" label="统一身份登录" />
          <p className="mt-2 text-sm text-neutral-500">跳转到学校统一身份平台，登录后自动回到教师端。</p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-neutral-500">统一身份登录（Casdoor）未配置。</p>
      )}
      {devLogin ? (
        <div className="mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <p className="text-sm text-neutral-500">开发环境快捷登录（生产必须关闭 AUTH_DEV_LOGIN）：</p>
          <div className="mt-2">
            <DevLoginButton role="teacher" label="以教师身份登录（开发）" />
          </div>
        </div>
      ) : oidc ? null : (
        <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">当前环境未开放开发登录，请等待统一身份登录上线。</p>
      )}
    </main>
  )
}
