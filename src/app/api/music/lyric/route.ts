import { NextRequest, NextResponse } from 'next/server'
import { findLyric, findLyricById, NeteaseError } from '@/lib/netease'

export const runtime = 'nodejs'

/**
 * GET /api/music/lyric
 *
 * 两种用法：
 *   1. ?id={网易云歌曲ID}         —— 精确获取（新主链路，推荐）
 *   2. ?keyword={关键词}          —— 按关键词搜索后匹配（兼容旧用法）
 *
 * 新链路下前端已拿到网易云曲目 id，直接用 id 取歌词，
 * 不再需要靠关键词猜测，准确率 100%。
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')?.trim()
  const keyword = req.nextUrl.searchParams.get('keyword')?.trim()

  try {
    // 优先按 id 精确获取
    if (id) {
      const songId = Number(id)
      if (!Number.isFinite(songId) || songId <= 0) {
        return NextResponse.json({ error: 'id 参数无效' }, { status: 400 })
      }
      const result = await findLyricById(songId)
      return NextResponse.json(result)
    }

    if (!keyword) {
      return NextResponse.json(
        { error: '请提供 id 或 keyword 参数' },
        { status: 400 },
      )
    }

    if (keyword.length > 100) {
      return NextResponse.json({ error: '关键词过长' }, { status: 400 })
    }

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
