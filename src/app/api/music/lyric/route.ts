import { NextRequest, NextResponse } from 'next/server'
import { findLyric, NeteaseError } from '@/lib/netease'

export const runtime = 'nodejs'

/**
 * GET /api/music/lyric?keyword={关键词}
 *
 * 按需获取歌词（含翻译）。前端只有用户点击"歌词"按钮时才调用。
 */
export async function GET(req: NextRequest) {
  const keyword = req.nextUrl.searchParams.get('keyword')?.trim()

  if (!keyword) {
    return NextResponse.json({ error: '请提供关键词' }, { status: 400 })
  }

  if (keyword.length > 100) {
    return NextResponse.json({ error: '关键词过长' }, { status: 400 })
  }

  try {
    const result = await findLyric(keyword)
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof NeteaseError) {
      return NextResponse.json({ error: e.message }, { status: 502 })
    }
    console.error('[api/music/lyric]', e)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
