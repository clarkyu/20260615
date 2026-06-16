import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { getCurrentUser } from '@/lib/auth'
import { config, validateConfigOnce } from '@/lib/config'
import { getLocale } from '@/lib/i18n-server'
import { I18nProvider } from '@/components/i18n-provider'
import { AppHeader } from '@/components/app-header'
import { BottomNav } from '@/components/bottom-nav'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

const APP_NAME = config.appName()

export const metadata: Metadata = {
  title: APP_NAME,
  description: '你好！作业 — 手机端背诵作业：录制提交、AI 评阅、按班级统计导出',
  manifest: '/manifest.webmanifest',
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
const themeInit = `(function(){try{var m=document.cookie.match(/(?:^|; )theme=([^;]+)/);var t=m?m[1]:'system';if(t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()`

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // One-time redacted config check so a misconfigured deploy is visible in logs.
  validateConfigOnce()
  const [locale, user] = await Promise.all([getLocale(), getCurrentUser()])

  return (
    <html lang={locale === 'zh' ? 'zh-CN' : 'en'} className={inter.variable} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <I18nProvider locale={locale}>
          <AppHeader user={user} />
          <main className="mx-auto w-full max-w-xl px-4 pt-5" style={{ paddingBottom: user ? '6.5rem' : '2rem' }}>
            <div key={locale} className="animate-in-up">{children}</div>
          </main>
          {user ? <BottomNav role={user.role} /> : null}
        </I18nProvider>
      </body>
    </html>
  )
}
