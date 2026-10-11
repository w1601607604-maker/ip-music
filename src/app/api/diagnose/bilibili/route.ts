import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * GET /api/diagnose/bilibili
 *
 * 诊断 B站各端点的可达性。
 *
 * 背景：B站对数据中心 IP（如 Cloudflare Workers 出口）有风控，
 * 部分端点会返回 412。此接口逐个测试各端点，帮助定位问题。
 */
export async function GET() {
  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

  const endpoints: Array<[string, string]> = [
    [
      'all/v2（当前主方案）',
      'https://api.bilibili.com/x/web-interface/search/all/v2?keyword=test&page=1',
    ],
    [
      'search/type（回退方案）',
      'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=test&page=1',
    ],
    [
      '视频详情（低风控端点）',
      'https://api.bilibili.com/x/web-interface/view?bvid=BV1xp411Z79x',
    ],
    ['B站首页', 'https://www.bilibili.com/'],
  ]

  const results = []

  for (const [name, url] of endpoints) {
    const started = Date.now()
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
        signal: AbortSignal.timeout(12000),
      })

      let apiCode: number | null = null
      if (res.headers.get('content-type')?.includes('json')) {
        try {
          apiCode = (await res.json())?.code ?? null
        } catch {
          /* ignore */
        }
      }

      results.push({
        name,
        status: res.status,
        apiCode,
        elapsedMs: Date.now() - started,
        ok: res.ok && (apiCode === 0 || apiCode === null),
      })
    } catch (e) {
      results.push({
        name,
        error: String((e as any)?.message || e).slice(0, 120),
        elapsedMs: Date.now() - started,
        ok: false,
      })
    }
  }

  // 出口 IP（用于判断是否为数据中心 IP）
  let egressIp: string | null = null
  try {
    const r = await fetch('https://api.ipify.org', {
      signal: AbortSignal.timeout(8000),
    })
    if (r.ok) egressIp = (await r.text()).trim()
  } catch {
    /* ignore */
  }

  const searchOk = results[0]?.ok
  const verdict = searchOk
    ? '✅ B站搜索可用'
    : '❌ B站搜索被风控拦截（数据中心 IP 常见），需改用其他方案'

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    egressIp,
    verdict,
    endpoints: results,
  })
}
