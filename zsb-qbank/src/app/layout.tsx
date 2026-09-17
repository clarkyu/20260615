import type { Metadata, Viewport } from 'next'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: '专升本英语题库',
  description: '湖北专升本《大学英语》移动题库：作答、训练、模考',
}

// 视口(SPEC §7.7):不禁缩放,靠 ≥16px 输入字号规避 iOS 聚焦放大。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

// 根布局只放 html/body:学生端的单列骨架在 (student)/layout.tsx,教师端的宽容器在 (teacher)/teacher/layout.tsx。
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
