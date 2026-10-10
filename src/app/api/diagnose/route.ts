import { NextResponse } from 'next/server'

export const runtime = 'edge'

/**
 * GET /api/diagnose
 *
 * 诊断 Bangumi 连通性，帮助定位是 DNS、网络还是 API 问题。
 *
 * 使用 DNS-over-HTTPS（而非 node:dns）查询，原因：
 *  1. 兼容 Cloudflare Pages 的 Edge Runtime（无 node:dns）
 *  2. DoH 由外部解析器返回结果，能对比出本地 DNS 是否被污染
 */
export async function GET() {
  const result: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    runtime: 'edge',
  }

  // 1. 通过 DoH 查询 api.bgm.tv 的真实解析结果
  let dohAddresses: string[] = []
  let dohError: string | null = null

  try {
    const res = await fetch(
      'https://doh.pub/dns-query?name=api.bgm.tv&type=A',
      {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(8000),
      },
    )
    if (res.ok) {
      const data = await res.json()
      dohAddresses = (data?.Answer || [])
        .filter((a: any) => a?.type === 1)
        .map((a: any) => a.data)
    } else {
      dohError = `DoH 返回 HTTP ${res.status}`
    }
  } catch (e) {
    dohError = String((e as any)?.message || e)
  }

  result.dns = {
    ok: dohAddresses.length > 0,
    addresses: dohAddresses,
    error: dohError,
    // 已知的污染特征：解析到 Dropbox / Facebook / 其他无关服务的 IP 段
    suspicious: dohAddresses.some(
      (ip) =>
        ip.startsWith('162.125.') || // Dropbox
        ip.startsWith('108.160.') || // Dropbox
        ip.startsWith('69.63.') || // Facebook
        ip.startsWith('31.13.') || // Facebook
        ip.startsWith('157.240.') || // Facebook
        ip.startsWith('179.60.') || // Facebook
        ip.startsWith('185.60.') || // Facebook
        ip.startsWith('127.') || // 本地回环（DNS 劫持常见特征）
        ip === '0.0.0.0',
    ),
  }

  // 2. HTTPS 连通性（这是真正决定功能是否可用的指标）
  const started = Date.now()
  try {
    const res = await fetch('https://api.bgm.tv/v0/subjects/253', {
      headers: { 'User-Agent': 'ip-music/0.1 (diagnose)' },
      signal: AbortSignal.timeout(10000),
    })
    result.http = {
      ok: res.ok,
      status: res.status,
      elapsedMs: Date.now() - started,
    }
  } catch (e) {
    result.http = {
      ok: false,
      elapsedMs: Date.now() - started,
      error: String((e as any)?.message || e),
      code: (e as any)?.cause?.code || (e as any)?.code || null,
    }
  }

  // 3. 结论
  const httpInfo = result.http as any
  const dnsInfo = result.dns as any

  if (httpInfo.ok) {
    result.verdict = '✅ Bangumi 可正常访问，功能应可正常使用'
  } else if (dnsInfo?.suspicious) {
    result.verdict =
      '❌ DNS 被污染：api.bgm.tv 解析到了 Dropbox/Facebook 的 IP。请更换 DNS（如 223.5.5.5）或使用代理'
  } else if (!dnsInfo?.ok) {
    result.verdict = '⚠️ 无法通过 DoH 查询 DNS，但 HTTPS 请求也失败了，详见 http 字段'
  } else if (httpInfo.code === 'ETIMEDOUT') {
    result.verdict =
      '❌ 连接超时：DNS 正常但连不上，可能是 SNI 阻断或需要代理'
  } else {
    result.verdict = '❌ 无法访问 Bangumi，详见上方 http 字段'
  }

  return NextResponse.json(result)
}
