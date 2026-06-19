import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { cookies } from 'next/headers'
import './globals.css'
import { getCurrentUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { config, validateConfigOnce } from '@/lib/config'
import { getLocale } from '@/lib/i18n-server'
import { parseTzOffset } from '@/lib/time'
import * as userRepo from '@/lib/repo/users'
import * as submissionRepo from '@/lib/repo/submissions'
import { I18nProvider } from '@/components/i18n-provider'
import { TzOffsetProvider } from '@/components/tz-provider'
import { AppHeader } from '@/components/app-header'
import { BottomNav } from '@/components/bottom-nav'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

const APP_NAME = config.appName()

export const metadata: Metadata = {
  title: APP_NAME,
  description: '你好！作业 — 手机端背诵作业：录制提交、AI 评阅、按班级统计导出',
  manifest: '/manifest.webmanifest',
  // iOS ignores SVG/manifest icons for the home screen — give it a real PNG.
  icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: APP_NAME },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#4f46e5' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1019' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

// Set the theme class before paint so there's no flash of the wrong theme.
const themeInit = `(function(){try{var m=document.cookie.match(/(?:^|; )theme=([^;]+)/);var t=m?m[1]:'system';if(t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}try{document.cookie='tzo='+new Date().getTimezoneOffset()+';path=/;max-age=31536000;samesite=lax'}catch(e){}})()`

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // One-time redacted config check so a misconfigured deploy is visible in logs.
  validateConfigOnce()
  const [locale, user, cookieStore] = await Promise.all([getLocale(), getCurrentUser(), cookies()])
  const tzo = parseTzOffset(cookieStore.get('tzo')?.value)

  // 站内未读提示：学生有「比上次看过更晚批阅」的成绩时，底部导航「作业」上点红点。
  let newScores = false
  if (user && user.role === 'STUDENT') {
    const prisma = await getDb()
    const seen = await userRepo.scoresSeenAt(prisma, user.userId)
    newScores = (await submissionRepo.countNewlyGraded(prisma, user.userId, seen?.scoresSeenAt ?? null)) > 0
  }

  return (
    <html lang={locale === 'zh' ? 'zh-CN' : locale} className={inter.variable} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <I18nProvider locale={locale}>
          <TzOffsetProvider offset={tzo}>
            <AppHeader user={user} />
            <main className="mx-auto w-full max-w-xl px-4 pt-5" style={{ paddingBottom: user ? '6.5rem' : '2rem' }}>
              <div key={locale} className="animate-in-up">{children}</div>
            </main>
            {user ? <BottomNav role={user.panelRole} newScores={newScores} /> : null}
          </TzOffsetProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
