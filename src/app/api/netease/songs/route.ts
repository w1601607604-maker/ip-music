import { NextResponse } from 'next/server'
import { searchSongsForWork, NeteaseError } from '@/lib/netease'
import { fetchRelatedMusicNames } from '@/lib/bangumi'

export const runtime = 'nodejs'

/**
 * GET /api/netease/songs?name=CLANNAD&alt=クラナド&subjectId=253
 *
 * 按作品名搜索网易云曲目列表。
 *
 * 关键词来源（三路合并）：
 *   1. name      —— 作品名（中文译名）
 *   2. alt       —— 原名（通常是日文）
 *   3. subjectId —— Bangumi 条目 id，用于拉取关联音乐条目名
 *
 * 第 3 路很关键：像「少女歌剧 黄金国」这类译名特殊的作品，
 * 直接搜作品名在网易云几乎搜不到，但通过 Bangumi 的关联音乐
 * 条目（OST 专辑名）就能找到对应内容。
 *
 * 不涉及 B站，因此不受 B站风控影响。
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const name = (searchParams.get('name') || '').trim()
  const alt = (searchParams.get('alt') || '').trim()
  const subjectIdRaw = (searchParams.get('subjectId') || '').trim()

  if (!name) {
    return NextResponse.json({ error: '缺少 name 参数' }, { status: 400 })
  }

  if (name.length > 120) {
    return NextResponse.json({ error: 'name 参数过长' }, { status: 400 })
  }

  // 拉取 Bangumi 关联音乐条目名（失败时静默降级为空数组）
  let relatedNames: string[] = []
  const subjectId = Number(subjectIdRaw)
  if (Number.isFinite(subjectId) && subjectId > 0) {
    relatedNames = await fetchRelatedMusicNames(subjectId, 6)
  }

  try {
    const data = await searchSongsForWork(name, 30, alt || undefined, relatedNames)
    return NextResponse.json({
      data,
      // 回传实际使用的补充关键词，便于排查
      relatedNames,
    })
  } catch (e) {
    const message =
      e instanceof NeteaseError
        ? e.message
        : `网易云搜索失败：${e instanceof Error ? e.message : String(e)}`
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
