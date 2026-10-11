import { NextRequest, NextResponse } from 'next/server'
import { searchMusicForSong, searchMusicForWork, BilibiliError } from '@/lib/bilibili'

export const runtime = 'nodejs'

/**
 * GET /api/music/search
 *
 * 两种用法：
 *   1. ?song={歌名}&artist={歌手}  —— 按曲目搜索播放源（新主链路，推荐）
 *   2. ?name={作品名}              —— 按作品名搜索（旧用法，保留兼容）
 *
 * 新链路下 B站请求只在用户点击具体歌曲时触发，请求量大幅降低，
 * 可显著减少被风控拦截的概率。
 */
export async function GET(req: NextRequest) {
  const song = req.nextUrl.searchParams.get('song')?.trim()
  const artist = req.nextUrl.searchParams.get('artist')?.trim() || ''
  const name = req.nextUrl.searchParams.get('name')?.trim()

  // 优先按曲目搜索
  if (song) {
    if (song.length > 120) {
      return NextResponse.json({ error: '歌名过长' }, { status: 400 })
    }
    try {
      const items = await searchMusicForSong(song, artist)
      return NextResponse.json({ data: items })
    } catch (e) {
      return errorResponse(e)
    }
  }

  // 兼容旧的按作品名搜索
  if (name) {
    if (name.length > 100) {
      return NextResponse.json({ error: '作品名过长' }, { status: 400 })
    }
    try {
      const items = await searchMusicForWork(name)
      return NextResponse.json({ data: items })
    } catch (e) {
      return errorResponse(e)
    }
  }

  return NextResponse.json(
    { error: '请提供 song（歌名）或 name（作品名）参数' },
    { status: 400 },
  )
}

function errorResponse(e: unknown) {
  if (e instanceof BilibiliError) {
    const status = e.status === 412 ? 429 : 502
    return NextResponse.json({ error: e.message }, { status })
  }
  console.error('[api/music/search]', e)
  return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
}
