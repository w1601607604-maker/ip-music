import { NextRequest, NextResponse } from 'next/server'
import { searchMusicForWork, BilibiliError } from '@/lib/bilibili'

export const runtime = 'nodejs'
/** B站搜索较慢（多关键词串行 + 间隔），给足超时 */
export const maxDuration = 60

/**
 * GET /api/music/search?name={作品名}
 *
 * 按作品名搜索 B站音乐视频，优先返回 OST / 合集类内容。
 */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')?.trim()

  if (!name) {
    return NextResponse.json({ error: '请提供作品名' }, { status: 400 })
  }

  if (name.length > 100) {
    return NextResponse.json({ error: '作品名过长' }, { status: 400 })
  }

  try {
    const items = await searchMusicForWork(name)
    return NextResponse.json({ data: items })
  } catch (e) {
    if (e instanceof BilibiliError) {
      const status = e.status === 412 ? 429 : 502
      return NextResponse.json({ error: e.message }, { status })
    }
    console.error('[api/music/search]', e)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
