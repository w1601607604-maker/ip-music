import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * GET /api/diagnose/raw?url={编码后的URL}
 *
 * 返回指定 URL 的原始响应（截断），用于排查服务器环境下
 * 第三方接口返回内容与本地不一致的问题。
 *
 * 仅允许白名单域名，避免被滥用为开放代理。
 */
const ALLOWED_HOSTS = [
  'music.163.com',
  'api.bilibili.com',
  'www.bilibili.com',
  'api.bgm.tv',
]

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const target = searchParams.get('url')

  if (!target) {
    return NextResponse.json({ error: '缺少 url 参数' }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return NextResponse.json({ error: 'url 无效' }, { status: 400 })
  }

  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    return NextResponse.json(
      { error: `域名不在白名单：${parsed.hostname}` },
      { status: 403 },
    )
  }

  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

  try {
    const res = await fetch(target, {
      headers: {
        'User-Agent': UA,
        Referer: `https://${parsed.hostname}/`,
        Accept: 'application/json, text/plain, */*',
      },
      signal: AbortSignal.timeout(12000),
    })

    const text = await res.text()

    return NextResponse.json({
      target,
      status: res.status,
      contentType: res.headers.get('content-type'),
      length: text.length,
      // 截断，避免响应过大
      body: text.slice(0, 1200),
    })
  } catch (e) {
    return NextResponse.json({
      target,
      error: String((e as any)?.message || e).slice(0, 200),
    })
  }
}
