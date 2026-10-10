/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // 开发与构建使用不同的输出目录，避免 `next dev` 与 `next build`
  // 同时操作 `.next` 导致产物损坏（MODULE_NOT_FOUND / Cannot find module './xxx.js'）。
  // 开发时输出到 .next-dev，构建时输出到 .next。
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',

  images: {
    // Bangumi 封面与 B站封面使用外部域名，这里放开
    remotePatterns: [
      { protocol: 'https', hostname: 'lain.bgm.tv' },
      { protocol: 'https', hostname: 'i0.hdslb.com' },
      { protocol: 'https', hostname: 'i1.hdslb.com' },
      { protocol: 'https', hostname: 'i2.hdslb.com' },
    ],
  },
}

module.exports = nextConfig
