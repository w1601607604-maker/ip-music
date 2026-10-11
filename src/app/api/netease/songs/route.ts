import { NextResponse } from 'next/server'
import { searchSongsForWork, NeteaseError } from '@/lib/netease'

export const runtime = 'nodejs'

/**
 * GET /api/netease/songs?name=CLANNAD
 *
 * 按作品名搜索网易云曲目列表。
 *
 * 这是主链路的第一步：作品名 → 网易云曲目（曲名/歌手/专辑）。
 * 不涉及 B站，因此不受 B站风控影响。
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const name = (searchParams.get('name') || '').trim()

  if (!name) {
    return NextResponse.json({ error: '缺少 name 参数' }, { status: 400 })
  }

  if (name.length > 120) {
    return NextResponse.json({ error: 'name 参数过长' }, { status: 400 })
  }

  try {
    const data = await searchSongsForWork(name)
    return NextResponse.json({ data })
  } catch (e) {
    const message =
      e instanceof NeteaseError
        ? e.message
        : `网易云搜索失败：${e instanceof Error ? e.message : String(e)}`
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
