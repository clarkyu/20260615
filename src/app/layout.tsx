import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { getCurrentUser } from '@/lib/auth'
import { getLocale } from '@/lib/i18n-server'
import { I18nProvider } from '@/components/i18n-provider'
import { AppHeader } from '@/components/app-header'
import { BottomNav } from '@/components/bottom-nav'

const inter = Inter({ subsets: ['latin'] })

const APP_NAME = process.env.APP_NAME || '你好！作业 Hi, Homework'

export const metadata: Metadata = {
  title: APP_NAME,
  description: '你好！作业 — 手机端背诵作业：录制提交、AI 评阅、按班级统计导出',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: APP_NAME },
}

export const viewport: Viewport = {
  themeColor: '#4f46e5',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, user] = await Promise.all([getLocale(), getCurrentUser()])

  return (
    <html lang={locale === 'zh' ? 'zh-CN' : 'en'}>
      <body className={inter.className}>
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
