import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'IP-Music · Bangumi 作品音乐',
  description: '输入 Bangumi 用户 ID，收听你收藏作品的相关音乐',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  )
}
