import Link from 'next/link'
import { logout } from '@/actions/auth'
import { getCurrentUser } from '@/lib/auth'
import { Button } from '@/components/ui/button'

const APP_NAME = process.env.APP_NAME || '英语背诵作业'

export async function Navbar() {
  const user = await getCurrentUser()
  const isStaff = user && user.role !== 'STUDENT'

  return (
    <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="text-base font-bold tracking-tight">
          {APP_NAME}
        </Link>
        <div className="flex items-center gap-2 text-sm">
          {isStaff ? (
            <>
              <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
                看板
              </Link>
              <Link href="/dashboard/students" className="text-muted-foreground hover:text-foreground">
                学生
              </Link>
              <Link href="/dashboard/assignments" className="text-muted-foreground hover:text-foreground">
                作业
              </Link>
              <form action={logout}>
                <Button type="submit" variant="outline" size="sm">
                  退出
                </Button>
              </form>
            </>
          ) : user ? (
            <>
              <Link href="/student" className="text-muted-foreground hover:text-foreground">
                我的作业
              </Link>
              <form action={logout}>
                <Button type="submit" variant="outline" size="sm">
                  退出
                </Button>
              </form>
            </>
          ) : (
            <Link href="/login">
              <Button variant="outline" size="sm">
                登录
              </Button>
            </Link>
          )}
        </div>
      </div>
    </nav>
  )
}
