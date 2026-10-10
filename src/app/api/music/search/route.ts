import { NextRequest, NextResponse } from 'next/server'
import { searchMusicForWork, BilibiliError } from '@/lib/bilibili'

export const runtime = 'edge'
// 注意：Edge Runtime 不支持 maxDuration，超时由平台限制决定。
// B站搜索为多关键词串行 + 风控间隔，单次约 6~11 秒，在平台限制内。

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
