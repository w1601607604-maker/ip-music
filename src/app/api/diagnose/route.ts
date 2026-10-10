import { NextResponse } from 'next/server'
import { promises as dns } from 'node:dns'

export const runtime = 'nodejs'

/**
 * GET /api/diagnose
 *
 * 诊断 Bangumi 连通性，帮助定位是 DNS、网络还是 API 问题。
 * 不依赖任何外部参数，随时可访问。
 */
export async function GET() {
  const result: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    node: process.version,
  }

  // 1. DNS 解析
  try {
    const addrs = await dns.resolve4('api.bgm.tv').catch(() => [] as string[])
    result.dns = {
      ok: addrs.length > 0,
      addresses: addrs,
      // 已知的污染特征：解析到 Dropbox / Facebook 的 IP 段
      suspicious: addrs.some(
        (ip) =>
          ip.startsWith('162.125.') || // Dropbox
          ip.startsWith('69.63.') || // Facebook
          ip.startsWith('108.160.') || // Dropbox
          ip.startsWith('31.13.'), // Facebook
      ),
    }
  } catch (e) {
    result.dns = { ok: false, error: String(e) }
  }

  // 2. HTTPS 连通性
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
    const cause = (e as any)?.cause
    result.http = {
      ok: false,
      elapsedMs: Date.now() - started,
      error: String((e as any)?.message || e),
      code: cause?.code || (e as any)?.code || null,
    }
  }

  // 3. 结论
  const dnsInfo = result.dns as any
  const httpInfo = result.http as any

  if (httpInfo.ok) {
    result.verdict = '✅ Bangumi 可正常访问，功能应可正常使用'
  } else if (dnsInfo?.suspicious) {
    result.verdict =
      '❌ DNS 被污染：api.bgm.tv 解析到了 Dropbox/Facebook 的 IP。请更换 DNS（如 223.5.5.5）或使用代理'
  } else if (!dnsInfo?.ok) {
    result.verdict = '❌ DNS 解析失败：无法解析 api.bgm.tv，请检查 DNS 设置'
  } else if (httpInfo.code === 'ETIMEDOUT') {
    result.verdict = '❌ 连接超时：DNS 正常但连不上，可能需要代理'
  } else {
    result.verdict = '❌ 无法访问 Bangumi，详见上方 http 字段'
  }

  return NextResponse.json(result)
}
