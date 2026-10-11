import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * GET /api/diagnose/bilibili
 *
 * 诊断各数据源在服务器环境下的可达性。
 *
 * 背景：B站与网易云对数据中心 IP（如 Cloudflare Workers 出口）
 * 有风控策略，可能导致接口返回 412 或空结果。
 * 此接口逐个测试，帮助定位问题出在哪一环。
 */
export async function GET() {
  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

  const endpoints: Array<[string, string, string]> = [
    // [名称, URL, Referer]
    [
      'B站 all/v2',
      'https://api.bilibili.com/x/web-interface/search/all/v2?keyword=test&page=1',
      'https://www.bilibili.com/',
    ],
    [
      'B站 search/type',
      'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=test&page=1',
      'https://www.bilibili.com/',
    ],
    [
      'B站首页',
      'https://www.bilibili.com/',
      'https://www.bilibili.com/',
    ],
    [
      '网易云搜索',
      'https://music.163.com/api/search/get/web?s=CLANNAD&type=1&limit=5',
      'https://music.163.com/',
    ],
    [
      '网易云歌词',
      'https://music.163.com/api/song/lyric?id=760533&lv=1&kv=1&tv=-1',
      'https://music.163.com/',
    ],
    [
      'Bangumi',
      'https://api.bgm.tv/v0/subjects/253',
      'https://bgm.tv/',
    ],
  ]

  interface EndpointResult {
    name: string
    status?: number
    apiCode?: number | null
    itemCount?: number | null
    error?: string
    elapsedMs: number
    ok: boolean
  }

  const results: EndpointResult[] = []

  for (const [name, url, referer] of endpoints) {
    const started = Date.now()
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: referer },
        signal: AbortSignal.timeout(12000),
      })

      let apiCode: number | null = null
      let itemCount: number | null = null

      if (res.headers.get('content-type')?.includes('json')) {
        try {
          const j = await res.json()
          apiCode = j?.code ?? null
          // 网易云搜索：统计歌曲数
          if (j?.result?.songs) itemCount = j.result.songs.length
          // B站 all/v2：统计视频数
          if (Array.isArray(j?.data?.result)) {
            for (const g of j.data.result) {
              if (g?.result_type === 'video') {
                itemCount = (g.data || []).length
                break
              }
            }
          }
          // B站 search/type
          if (Array.isArray(j?.data?.result) && itemCount === null) {
            itemCount = j.data.result.length
          }
        } catch {
          /* ignore */
        }
      }

      results.push({
        name,
        status: res.status,
        apiCode,
        itemCount,
        elapsedMs: Date.now() - started,
        ok: res.ok && (apiCode === 0 || apiCode === 200 || apiCode === null),
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

  // 出口 IP
  let egressIp: string | null = null
  try {
    const r = await fetch('https://api.ipify.org', {
      signal: AbortSignal.timeout(8000),
    })
    if (r.ok) egressIp = (await r.text()).trim()
  } catch {
    /* ignore */
  }

  const byName = (n: string) => results.find((r) => r.name === n)
  const neteaseOk = byName('网易云搜索')?.ok
  const biliOk = byName('B站 all/v2')?.ok || byName('B站 search/type')?.ok

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    egressIp,
    summary: {
      netease: neteaseOk ? '✅ 可用' : '❌ 不可用',
      bilibili: biliOk ? '✅ 可用' : '❌ 不可用',
      bangumi: byName('Bangumi')?.ok ? '✅ 可用' : '❌ 不可用',
    },
    endpoints: results,
  })
}
