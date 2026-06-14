import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Navbar } from '@/components/navbar'

const inter = Inter({ subsets: ['latin'] })

const APP_NAME = process.env.APP_NAME || '英语背诵作业'

export const metadata: Metadata = {
  title: APP_NAME,
  description: '手机端英语背诵作业：录制提交、AI 评阅、按班级统计导出',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: APP_NAME },
}

export const viewport: Viewport = {
  themeColor: '#0b1220',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark">
      <body className={inter.className}>
        <Navbar />
        <main className="mx-auto w-full max-w-2xl px-4 py-6">{children}</main>
      </body>
    </html>
  )
}
